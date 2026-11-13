package xyz.grimreplay;

import com.google.gson.*;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.commands.Commands;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.file.*;
import java.util.*;

public final class ReplayMod implements ModInitializer {
    public static ReplayMod INSTANCE;
    static final Logger LOG=LoggerFactory.getLogger("grim-replay");
    static final Gson JSON=new GsonBuilder().setPrettyPrinting().serializeNulls().create();
    private final Path dir=FabricLoader.getInstance().getConfigDir().resolve("grim-replay");
    private volatile RecorderConfig config;
    private Uploader uploader;
    private MinecraftServer server;
    private long tick;private int scanPlayer;
    private final LinkedHashMap<UUID,Recording> recordings=new LinkedHashMap<>();
    private final Set<UUID> paused=new HashSet<>();
    private final IdentityHashMap<BlockState,String> stateNames=new IdentityHashMap<>();
    private GrimHook grimHook;
    private record FlagInput(UUID uuid,String check,double vl,String verbose){}
    private final java.util.concurrent.ArrayBlockingQueue<FlagInput> pendingFlags=new java.util.concurrent.ArrayBlockingQueue<>(256);
    private double lastCaptureMs,maxCaptureMs;
    public void onInitialize(){
        INSTANCE=this;
        try{config=RecorderConfig.read(dir.resolve("config.json"));}catch(Exception e){throw new IllegalStateException("Invalid grim-replay/config.json",e);}
        try{Path credentials=dir.resolve("web-credential.json");if(!Files.exists(credentials))Files.writeString(credentials,"{\"web-token\":\"REPLACE_WITH_VPS_INGEST_TOKEN\"}\n");}catch(Exception e){LOG.warn("Cannot create credentials template",e);}
        uploader=new Uploader(dir,config);
        ServerLifecycleEvents.SERVER_STARTED.register(s->{server=s;grimHook=new GrimHook(this,s);if(config.grimEvents)grimHook.install();uploader.retry(config);});
        ServerLifecycleEvents.SERVER_STOPPING.register(s->{for(var r:recordings.values())if(!r.frames.isEmpty()&&(r.manual||r.saveAt>=0))save(r,null);uploader.close();if(grimHook!=null)grimHook.close();});
        ServerTickEvents.END_SERVER_TICK.register(this::onTick);
        CommandRegistrationCallback.EVENT.register((dispatcher,registry,environment)->{
            var root=Commands.literal("replay").requires(s->s.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER));
            root.executes(c->reply(c.getSource(),"/replay status | start/stop/save <player> | flag <player> <check> | reload | set <key> <value> | retry"));
            root.then(Commands.literal("status").executes(c->reply(c.getSource(),"players="+recordings.size()+"/"+config.maxPlayers+", queued="+uploader.queued()+", captureMs last/max="+String.format(Locale.ROOT,"%.2f/%.2f",lastCaptureMs,maxCaptureMs)+", Grim="+(grimHook==null?"not started":grimHook.status)+", upload="+uploader.lastResult)));
            for(String action:List.of("start","stop","save")){
                var cmd=Commands.literal(action).then(Commands.argument("player",EntityArgument.player()).executes(c->control(c.getSource(),EntityArgument.getPlayer(c,"player"),action,null))
                    .then(Commands.argument("code",StringArgumentType.word()).executes(c->control(c.getSource(),EntityArgument.getPlayer(c,"player"),action,StringArgumentType.getString(c,"code")))));
                root.then(cmd);
            }
            root.then(Commands.literal("flag").then(Commands.argument("player",EntityArgument.player()).then(Commands.argument("check",StringArgumentType.greedyString()).executes(c->{var p=EntityArgument.getPlayer(c,"player");flag(p.getUUID(),StringArgumentType.getString(c,"check"),0,"Console command trigger");return reply(c.getSource(),"Flag queued for "+p.getName().getString());}))));
            root.then(Commands.literal("retry").executes(c->reply(c.getSource(),uploader.retry(config)?"Spool retry queued":"Upload queue full")));
            root.then(Commands.literal("reload").executes(c->{try{RecorderConfig next=RecorderConfig.read(dir.resolve("config.json"));if(next.queueCapacity!=config.queueCapacity)return reply(c.getSource(),"queueCapacity changes require restart");config=next;recordings.clear();paused.clear();return reply(c.getSource(),"Reloaded; capture buffers reset. grimEvents changes require restart.");}catch(Exception e){return reply(c.getSource(),"Reload rejected: "+e.getMessage());}}));
            root.then(Commands.literal("set").then(Commands.argument("key",StringArgumentType.word()).then(Commands.argument("value",StringArgumentType.greedyString()).executes(c->{try{
                String key=StringArgumentType.getString(c,"key"),value=StringArgumentType.getString(c,"value");
                if(key.equals("queueCapacity")||key.equals("grimEvents"))return reply(c.getSource(),"Edit config.json and restart for "+key);
                var field=RecorderConfig.class.getField(key);RecorderConfig next=JSON.fromJson(JSON.toJson(config),RecorderConfig.class);
                if(field.getType()==boolean.class){if(!value.equals("true")&&!value.equals("false"))throw new IllegalArgumentException("Use true or false");field.set(next,Boolean.parseBoolean(value));}
                else if(field.getType()==int.class)field.set(next,Integer.parseInt(value));else field.set(next,value);
                next.validate();RecorderConfig.write(dir.resolve("config.json"),next);config=next;recordings.clear();return reply(c.getSource(),"Saved "+key+"; capture buffers reset.");
            }catch(Exception e){return reply(c.getSource(),"Setting rejected: "+e.getMessage());}}))));
            dispatcher.register(root);
        });
    }
    private int reply(CommandSourceStack source,String text){source.sendSuccess(()->Component.literal(text),false);return 1;}
    private int control(CommandSourceStack source,ServerPlayer p,String action,String code){
        if(code!=null&&!code.matches("[A-Za-z0-9_-]{1,128}"))return reply(source,"Invalid paste code");
        if(action.equals("start")){paused.remove(p.getUUID());var r=getOrStart(p);if(r==null)return reply(source,"Player limit reached");r.manual=true;return reply(source,"Recording "+p.getName().getString());}
        var r=recordings.get(p.getUUID());if(r==null)return reply(source,"No recording for player");
        String id=save(r,code);if(action.equals("stop")&&id!=null){recordings.remove(p.getUUID());paused.add(p.getUUID());}
        return reply(source,id==null?"Save not queued; check status":"Queued replay "+id);
    }
    private Recording getOrStart(ServerPlayer p){
        var r=recordings.get(p.getUUID());String dimension=p.level().dimension().identifier().toString();
        if(r!=null&&!r.dimension.equals(dimension)){if(r.manual||r.saveAt>=0)save(r,null);recordings.remove(p.getUUID());r=null;}
        if(r==null&&recordings.size()<config.maxPlayers){r=new Recording(p.getUUID(),p.getName().getString(),dimension);recordings.put(p.getUUID(),r);}return r;
    }
    void flag(UUID uuid,String check,double vl,String verbose){
        pendingFlags.offer(new FlagInput(uuid,check.substring(0,Math.min(check.length(),256)),Double.isFinite(vl)?vl:0,verbose.substring(0,Math.min(verbose.length(),4096))));
    }
    private void drainFlags(){
        FlagInput f;while((f=pendingFlags.poll())!=null){
            var p=server.getPlayerList().getPlayer(f.uuid());if(p==null)continue;var r=getOrStart(p);
            if(r==null){LOG.warn("Flag missed: recorder player limit reached for {}",f.uuid());continue;}
            if(r.frames.isEmpty())r.frames.add(Map.of("tick",tick,"x",p.getX(),"y",p.getY(),"z",p.getZ(),"yaw",p.getYRot(),"pitch",p.getXRot(),"pose",p.getPose().name().toLowerCase(Locale.ROOT),"onGround",p.onGround()));
            if(r.flags.size()<128)r.flags.add(Map.of("tick",tick,"check",f.check(),"vl",f.vl(),"verbose",f.verbose()));
            if(r.saveAt<0){r.saveAt=tick+config.postSeconds*20L;r.frozenStart=tick-(config.historySeconds-config.postSeconds)*20L;}
        }
    }
    private String save(Recording r,String code){if(r.frames.isEmpty())return null;var bundle=r.bundle(config.serverId,tick,code);return uploader.submit(bundle,config)?bundle.get("id").toString():null;}
    private void onTick(MinecraftServer s){
        tick++;if(!config.enabled){pendingFlags.clear();return;}long started=System.nanoTime();
        var online=s.getPlayerList().getPlayers();
        for(var it=recordings.entrySet().iterator();it.hasNext();){var entry=it.next();if(s.getPlayerList().getPlayer(entry.getKey())==null){if(entry.getValue().saveAt>=0||entry.getValue().manual)save(entry.getValue(),null);it.remove();}}
        if(config.autoRecord)for(var p:online)if(!paused.contains(p.getUUID()))getOrStart(p);
        for(var p:online){var r=recordings.get(p.getUUID());if(r==null)continue;r=getOrStart(p);if(r==null)continue;
            r.frames.add(Map.of("tick",tick,"x",p.getX(),"y",p.getY(),"z",p.getZ(),"yaw",p.getYRot(),"pitch",p.getXRot(),"pose",p.getPose().name().toLowerCase(Locale.ROOT),"onGround",p.onGround()));
            r.trim(r.frozenStart>=0?Math.max(tick-2400,r.frozenStart):tick-config.historySeconds*20L);
        }
        drainFlags();
        var active=online.stream().filter(p->recordings.containsKey(p.getUUID())).toList();
        if(!active.isEmpty())for(int i=0;i<config.sectionsPerTick;i++){var p=active.get(Math.floorMod(scanPlayer++,active.size()));sample(p,recordings.get(p.getUUID()));}
        for(var r:recordings.values())if(r.saveAt>=0&&tick>=r.saveAt){if(save(r,null)!=null){r.saveAt=-1;r.frozenStart=-1;r.flags.clear();}else r.saveAt=tick+100;}
        lastCaptureMs=(System.nanoTime()-started)/1e6;maxCaptureMs=Math.max(maxCaptureMs,lastCaptureMs);
    }
    public void blockChanged(net.minecraft.world.level.Level level,net.minecraft.core.BlockPos pos,BlockState state){
        if(server==null||!config.enabled||!server.isSameThread())return;
        String dimension=level.dimension().identifier().toString();String key=Math.floorDiv(pos.getX(),16)+":"+Math.floorDiv(pos.getZ(),16)+":"+Math.floorDiv(pos.getY(),16);
        String name=null;
        for(var r:recordings.values())if(r.dimension.equals(dimension)&&r.sections.containsKey(key)){
            if(r.changes.size()>=config.maxBlockChanges){r.warnings.add("Block-change limit reached; some mutations were omitted.");continue;}
            if(name==null)name=stateNames.computeIfAbsent(state,this::stateName);
            r.changes.add(Map.of("tick",tick+1,"x",pos.getX(),"y",pos.getY(),"z",pos.getZ(),"state",name));
        }
    }
    private void sample(ServerPlayer p,Recording r){
        int min=Math.max(p.level().getMinSectionY(),Math.floorDiv(p.blockPosition().getY()-config.verticalRadius,16));
        int max=Math.min(p.level().getMaxSectionY(),Math.floorDiv(p.blockPosition().getY()+config.verticalRadius,16));
        int count=max-min+1,index=Math.floorMod(r.cursor++,9*count),column=index/count,sy=min+index%count;
        int cx=p.chunkPosition().x()+column%3-1,cz=p.chunkPosition().z()+column/3-1;
        var chunk=p.level().getChunkSource().getChunkNow(cx,cz);if(chunk==null)return;
        var section=chunk.getSection(chunk.getSectionIndexFromSectionY(sy));
        int[] indices=new int[4096];var palette=new ArrayList<String>();var ids=new IdentityHashMap<BlockState,Integer>();
        for(int y=0;y<16;y++)for(int z=0;z<16;z++)for(int x=0;x<16;x++){
            BlockState state=section.getBlockState(x,y,z);Integer id=ids.get(state);
            if(id==null){id=palette.size();ids.put(state,id);palette.add(stateNames.computeIfAbsent(state,this::stateName));}
            indices[y*256+z*16+x]=id;
        }
        r.add(new Recording.Section(cx,cz,sy,tick,List.copyOf(palette),indices),config);
    }
    private String stateName(BlockState state){
        String name=BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        var props=state.getValues().map(Object::toString).sorted().toList();return props.isEmpty()?name:name+"["+String.join(",",props)+"]";
    }
    @SuppressWarnings({"unchecked","rawtypes"}) private static String propertyValue(Property property,Comparable value){return property.getName(value);}
}
