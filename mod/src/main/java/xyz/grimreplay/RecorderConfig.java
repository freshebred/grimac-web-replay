package xyz.grimreplay;

import com.google.gson.*;
import java.nio.file.*;
import java.net.URI;

public final class RecorderConfig {
    public String serverId = "minecraft-server";
    public String apiUrl = "https://replay.example.com";
    public boolean enabled = true;
    public boolean autoRecord = true;
    public boolean grimEvents = true;
    public int maxPlayers = 4;
    public int historySeconds = 45;
    public int postSeconds = 15;
    public int verticalRadius = 32;
    public int sectionsPerTick = 4;
    public int maxSectionVersions = 1024;
    public int maxBlockChanges = 50000;
    public int maxTrackedSections = 256;
    public int entityRadius = 24;
    public int maxEntities = 32;
    public int maxEvents = 4096;
    public int queueCapacity = 4;
    public int maxSpoolMiB = 512;
    public int uploadRetries = 5;
    public void validate() {
        if (!serverId.matches("[A-Za-z0-9_.-]{1,64}")) throw new IllegalArgumentException("Invalid serverId");
        URI uri = URI.create(apiUrl);
        if (!"https".equals(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null) throw new IllegalArgumentException("apiUrl must be HTTPS without credentials/query/fragment");
        range(maxPlayers,1,32,"maxPlayers"); range(historySeconds,5,120,"historySeconds"); range(postSeconds,0,30,"postSeconds");
        if(postSeconds>=historySeconds) throw new IllegalArgumentException("postSeconds must be smaller than historySeconds");
        range(verticalRadius,16,128,"verticalRadius"); range(sectionsPerTick,1,64,"sectionsPerTick");
        range(maxBlockChanges,1000,100000,"maxBlockChanges"); range(maxSectionVersions,128,2048,"maxSectionVersions"); range(maxTrackedSections,64,1024,"maxTrackedSections"); if(maxTrackedSections>maxSectionVersions)throw new IllegalArgumentException("maxTrackedSections must not exceed maxSectionVersions");
        range(entityRadius,4,64,"entityRadius"); range(maxEntities,1,128,"maxEntities"); range(maxEvents,128,50000,"maxEvents");
        range(queueCapacity,1,16,"queueCapacity"); range(maxSpoolMiB,16,8192,"maxSpoolMiB"); range(uploadRetries,0,10,"uploadRetries");
    }
    static void range(int n,int lo,int hi,String key) { if(n<lo||n>hi) throw new IllegalArgumentException(key+" must be "+lo+".."+hi); }
    static RecorderConfig read(Path path) throws Exception {
        if(!Files.exists(path)) { RecorderConfig c=new RecorderConfig(); write(path,c); return c; }
        RecorderConfig c=ReplayMod.JSON.fromJson(Files.readString(path),RecorderConfig.class); if(c==null) throw new IllegalArgumentException("Empty config"); c.validate(); return c;
    }
    static void write(Path path,RecorderConfig c) throws Exception {
        c.validate(); Files.createDirectories(path.getParent()); Path tmp=path.resolveSibling(path.getFileName()+".tmp");
        Files.writeString(tmp,ReplayMod.JSON.toJson(c)); Files.move(tmp,path,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
    }
}
