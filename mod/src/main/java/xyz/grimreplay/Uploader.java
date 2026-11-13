package xyz.grimreplay;

import com.google.gson.JsonObject;
import java.nio.file.*;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.GZIPOutputStream;

final class Uploader implements AutoCloseable {
    private final ThreadPoolExecutor worker;
    private final Path spool,credentials;
    volatile String lastResult="idle";
    Uploader(Path directory,RecorderConfig config){
        spool=directory.resolve("spool");credentials=directory.resolve("web-credential.json");
        worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(config.queueCapacity),r->{Thread t=new Thread(r,"grim-replay-upload");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    }
    int queued(){return worker.getQueue().size();}
    boolean submit(Map<String,Object> bundle,RecorderConfig config){return enqueue(()->{
        try{
            Files.createDirectories(spool);long used;try(var files=Files.list(spool)){used=files.filter(p->p.toString().endsWith(".grimreplay")).mapToLong(p->{try{return Files.size(p);}catch(IOException e){return 0;}}).sum();}
            if(used>=config.maxSpoolMiB*1024L*1024)throw new IOException("Local spool full; new recording rejected");
            Path file=spool.resolve(bundle.get("id")+".grimreplay"),tmp=spool.resolve(bundle.get("id")+".tmp");
            try(var gzip=new GZIPOutputStream(Files.newOutputStream(tmp));var writer=new OutputStreamWriter(gzip,java.nio.charset.StandardCharsets.UTF_8)){ReplayMod.JSON.toJson(bundle,writer);}
            if(used+Files.size(tmp)>config.maxSpoolMiB*1024L*1024){Files.delete(tmp);throw new IOException("Local spool capacity exceeded");}
            Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE);send(file,config);
        }catch(Exception e){failure(e);}
    });}
    boolean retry(RecorderConfig config){return enqueue(()->{try{Files.createDirectories(spool);try(var files=Files.list(spool)){for(Path p:files.filter(p->p.toString().endsWith(".grimreplay")).sorted().toList())send(p,config);}}catch(Exception e){failure(e);}});}
    private boolean enqueue(Runnable r){try{worker.execute(r);return true;}catch(RejectedExecutionException e){lastResult="Upload queue full; recording not queued. Retry save later.";ReplayMod.LOG.warn(lastResult);return false;}}
    private void send(Path file,RecorderConfig config)throws Exception{
        JsonObject secret=ReplayMod.JSON.fromJson(Files.readString(credentials),JsonObject.class);
        String token=secret.get("web-token").getAsString();if(token.length()<24)throw new IOException("web-token missing or too short");
        try(HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).followRedirects(HttpClient.Redirect.NEVER).build()){
            for(int attempt=0;attempt<=config.uploadRetries;attempt++){
                try{
                    var request=HttpRequest.newBuilder(URI.create(config.apiUrl.replaceAll("/+$","")+"/api/ingest")).timeout(Duration.ofSeconds(60)).header("Authorization","Bearer "+token).header("Content-Type","application/octet-stream").POST(HttpRequest.BodyPublishers.ofFile(file)).build();
                    var response=client.send(request,HttpResponse.BodyHandlers.discarding());
                    if(response.statusCode()>=200&&response.statusCode()<300){Files.delete(file);lastResult="Uploaded "+file.getFileName();ReplayMod.LOG.info(lastResult);return;}
                    if(response.statusCode()<500&&response.statusCode()!=429){lastResult="Upload HTTP "+response.statusCode()+"; retained "+file.getFileName();ReplayMod.LOG.warn(lastResult);return;}
                    throw new IOException("Upload HTTP "+response.statusCode());
                }catch(IOException e){if(attempt==config.uploadRetries)throw e;Thread.sleep(Math.min(30_000,1000L<<attempt));}
            }
        }
    }
    private void failure(Exception e){lastResult=e.getClass().getSimpleName()+": "+e.getMessage()+"; pending files retained in spool";ReplayMod.LOG.warn(lastResult);}
    public void close(){worker.shutdown();}
}
