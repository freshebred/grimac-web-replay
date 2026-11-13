package xyz.grimreplay;
import java.lang.reflect.*;
import java.util.*;
import java.util.function.Supplier;
import net.minecraft.server.MinecraftServer;
/** Optional public API adapter; never cancels or alters checks. */
final class GrimHook implements AutoCloseable {
 private final ReplayMod mod; private Object bus,plugin; private Class<?> pluginType;
 volatile String status="unavailable (use /replay flag)";
 GrimHook(ReplayMod mod,MinecraftServer server){this.mod=mod;}
 void install(){try{
  ClassLoader loader=getClass().getClassLoader();
  Object api=Class.forName("ac.grim.grimac.api.GrimAPIProvider").getMethod("get").invoke(null);
  bus=Class.forName("ac.grim.grimac.api.GrimAbstractAPI").getMethod("getEventBus").invoke(api);
  pluginType=Class.forName("ac.grim.grimac.api.plugin.GrimPlugin");
  Class<?> dt=Class.forName("ac.grim.grimac.api.plugin.GrimPluginDescription");
  Object description=Proxy.newProxyInstance(loader,new Class[]{dt},(o,m,a)->switch(m.getName()){case "getVersion"->"0.1.0";case "getDescription"->"Grim Replay Bridge";case "getAuthors"->List.of("Grim Replay contributors");default->objectMethod(o,m,a);});
  plugin=Proxy.newProxyInstance(loader,new Class[]{pluginType},(o,m,a)->switch(m.getName()){case "getDescription"->description;case "getLogger"->java.util.logging.Logger.getLogger("grim-replay");case "getDataFolder"->net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("grim-replay").toFile();default->objectMethod(o,m,a);});
  Class<?> event=Class.forName("ac.grim.grimac.api.event.events.FlagEvent"),eventBus=Class.forName("ac.grim.grimac.api.event.EventBus");
  Object channel=eventBus.getMethod("get",Class.class).invoke(bus,event);
  Class<?> ht=Class.forName("ac.grim.grimac.api.event.events.FlagEvent$SupplierHandler"),ut=Class.forName("ac.grim.grimac.api.GrimUser"),ct=Class.forName("ac.grim.grimac.api.AbstractCheck");
  Method uuid=ut.getMethod("getUniqueId"),name=ct.getMethod("getCheckName"),vl=ct.getMethod("getViolations");
  Object handler=Proxy.newProxyInstance(loader,new Class[]{ht},(o,m,a)->{
   if(!m.getName().equals("onFlag"))return objectMethod(o,m,a);
   boolean cancelled=(Boolean)a[3];
   if(!cancelled)try{String verbose=String.valueOf(((Supplier<?>)a[2]).get());mod.flag((UUID)uuid.invoke(a[0]),String.valueOf(name.invoke(a[1])),((Number)vl.invoke(a[1])).doubleValue(),verbose.substring(0,Math.min(verbose.length(),4096)));}catch(Exception e){ReplayMod.LOG.warn("Grim replay callback failed: {}",e.getClass().getSimpleName());}
   return cancelled;
  });
  channel.getClass().getMethod("onFlagSupplier",pluginType,ht).invoke(channel,plugin,handler);
  status="connected (public FlagEvent channel)";ReplayMod.LOG.info("Grim replay hook {}",status);
 }catch(ReflectiveOperationException|LinkageError e){status="unsupported/missing Grim API; use /replay flag";ReplayMod.LOG.warn("{} ({})",status,e.getClass().getSimpleName());}}
 static Object objectMethod(Object o,Method m,Object[] a){return switch(m.getName()){case "toString"->"GrimReplayBridge";case "hashCode"->System.identityHashCode(o);case "equals"->o==a[0];default->null;};}
 public void close(){if(bus!=null&&plugin!=null)try{Class.forName("ac.grim.grimac.api.event.EventBus").getMethod("unregisterAllListeners",pluginType).invoke(bus,plugin);}catch(Exception ignored){}}
}
