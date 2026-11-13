package xyz.grimreplay;
import java.lang.reflect.*;
import java.util.*;
import java.util.function.Supplier;
import net.minecraft.server.MinecraftServer;
/** Optional public API adapter; supports both GrimAPI v1.2+ (subscribe) and legacy FlagEvent channels. */
final class GrimHook implements AutoCloseable {
 private final ReplayMod mod; private Object bus,plugin; private Class<?> pluginType;
 volatile String status="unavailable (use /replay flag)";
 GrimHook(ReplayMod mod,MinecraftServer server){this.mod=mod;}
 void install(){
  ClassLoader loader=getClass().getClassLoader();
  try{
   Object api=resolveApi(loader);
   bus=invokeAny(api,"getEventBus");
   try{
    installModernSubscribe(loader,api,bus);
    return;
   }catch(Throwable modernErr){
    installLegacyChannel(loader,bus);
   }
  }catch(Throwable e){
   status="unsupported/missing Grim API; use /replay flag";
   ReplayMod.LOG.warn("{} ({}: {})",status,e.getClass().getSimpleName(),e.getMessage());
  }
 }
 private Object resolveApi(ClassLoader loader)throws Exception{
  try{return Class.forName("ac.grim.grimac.api.GrimAPIProvider",true,loader).getMethod("get").invoke(null);}
  catch(Throwable ignored){return Class.forName("ac.grim.grimac.api.GrimAPI",true,loader).getField("INSTANCE").get(null);}
 }
 private void installModernSubscribe(ClassLoader loader,Object api,Object eventBus)throws Exception{
  Class<?> flagEventClass=findClass(loader,"ac.grim.grimac.api.event.events.FlagEvent","ac.grim.grimac.api.events.FlagEvent");
  Method subMethod=null;
  try{
   for(Method m:Class.forName("ac.grim.grimac.api.event.EventBus",true,loader).getMethods()){
    if(m.getName().equals("subscribe")&&m.getParameterCount()>=3){
     Class<?>[] pt=m.getParameterTypes();
     if(pt[1].isAssignableFrom(Class.class)&&pt[2].isInterface()){subMethod=m;break;}
    }
   }
  }catch(Throwable ignored){}
  if(subMethod==null){
   try{
    for(Method m:eventBus.getClass().getMethods()){
     if(m.getName().equals("subscribe")&&m.getParameterCount()>=3){
      Class<?>[] pt=m.getParameterTypes();
      if(pt[1].isAssignableFrom(Class.class)&&pt[2].isInterface()){subMethod=m;break;}
     }
    }
   }catch(Throwable ignored){}
  }
  if(subMethod==null)throw new NoSuchMethodException("EventBus.subscribe not found");
  Class<?> contextType=subMethod.getParameterTypes()[0];
  Class<?> listenerInterface=subMethod.getParameterTypes()[2];
  Object listener=Proxy.newProxyInstance(loader,new Class[]{listenerInterface},(o,m,a)->{
   if(a!=null&&a.length==1&&a[0]!=null&&flagEventClass.isInstance(a[0])){
    handleFlagEventObject(a[0]);
    return null;
   }
   return objectMethod(o,m,a);
  });
  List<Object> candidates=new ArrayList<>();
  if(contextType.equals(Object.class)){
   candidates.add(mod);
   candidates.add("grim_replay_bridge");
   candidates.add(ReplayMod.class);
   net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer("grim_replay_bridge").ifPresent(candidates::add);
  }
  try{
   Object gp=createGrimPluginProxy(loader);
   if(gp!=null)candidates.add(gp);
  }catch(Throwable ignored){}
  Throwable lastErr=null;
  for(Object ctx:candidates){
   if(ctx==null||!contextType.isAssignableFrom(ctx.getClass()))continue;
   try{
    Object[] args=new Object[subMethod.getParameterCount()];
    args[0]=ctx;args[1]=flagEventClass;args[2]=listener;
    for(int i=3;i<args.length;i++){
     Class<?> t=subMethod.getParameterTypes()[i];
     args[i]=t==int.class?0:t==boolean.class?false:null;
    }
    subMethod.invoke(eventBus,args);
    this.plugin=ctx;this.pluginType=contextType;
    status="connected (EventBus subscribe)";
    ReplayMod.LOG.info("Grim replay hook {}",status);
    return;
   }catch(Throwable t){lastErr=t instanceof InvocationTargetException ite&&ite.getCause()!=null?ite.getCause():t;}
  }
  throw lastErr!=null?new RuntimeException(lastErr):new IllegalStateException("No compatible EventBus context");
 }
 private void handleFlagEventObject(Object ev){
  try{
   Object cancelledObj=invokeOptional(ev,"isCancelled");
   if(Boolean.TRUE.equals(cancelledObj))return;
   Object user=invokeOptional(ev,"getUser");
   if(user==null)user=invokeOptional(ev,"getPlayer");
   if(user==null)return;
   Object uuidObj=invokeOptional(user,"getUniqueId");
   if(!(uuidObj instanceof UUID uuid))return;
   Object check=invokeOptional(ev,"getCheck");
   String checkName="Flag";double vl=0;
   if(check!=null){
    Object cn=invokeOptional(check,"getCheckName");
    if(cn==null)cn=invokeOptional(check,"getName");
    if(cn!=null)checkName=String.valueOf(cn);
    Object v=invokeOptional(check,"getViolations");
    if(v instanceof Number n)vl=n.doubleValue();
   }
   Object evVl=invokeOptional(ev,"getViolations");
   if(evVl==null)evVl=invokeOptional(ev,"getViolationLevel");
   if(evVl instanceof Number n)vl=n.doubleValue();
   Object verbObj=invokeOptional(ev,"getVerbose");
   String verbose=verbObj instanceof Supplier<?> s?String.valueOf(s.get()):verbObj!=null?String.valueOf(verbObj):"";
   mod.flag(uuid,checkName,vl,verbose.substring(0,Math.min(verbose.length(),4096)));
  }catch(Throwable e){
   ReplayMod.LOG.warn("Grim replay callback failed: {}",e.getClass().getSimpleName());
  }
 }
 private Object createGrimPluginProxy(ClassLoader loader)throws Exception{
  pluginType=Class.forName("ac.grim.grimac.api.plugin.GrimPlugin",true,loader);
  Object description=null;
  try{
   Class<?> dt=Class.forName("ac.grim.grimac.api.plugin.GrimPluginDescription",true,loader);
   description=Proxy.newProxyInstance(loader,new Class[]{dt},(o,m,a)->switch(m.getName()){case "getVersion"->"0.1.0";case "getDescription"->"Grim Replay Bridge";case "getAuthors"->List.of("Grim Replay contributors");default->objectMethod(o,m,a);});
  }catch(Throwable ignored){}
  final Object desc=description;
  return Proxy.newProxyInstance(loader,new Class[]{pluginType},(o,m,a)->switch(m.getName()){
   case "getDescription"->desc;
   case "getLogger"->java.util.logging.Logger.getLogger("grim-replay");
   case "getDataFolder"->net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("grim-replay").toFile();
   default->objectMethod(o,m,a);
  });
 }
 private void installLegacyChannel(ClassLoader loader,Object eventBus)throws Exception{
  plugin=createGrimPluginProxy(loader);
  Class<?> event=Class.forName("ac.grim.grimac.api.event.events.FlagEvent",true,loader),ebClass=Class.forName("ac.grim.grimac.api.event.EventBus",true,loader);
  Object channel=ebClass.getMethod("get",Class.class).invoke(eventBus,event);
  Class<?> ht=Class.forName("ac.grim.grimac.api.event.events.FlagEvent$SupplierHandler",true,loader),ut=Class.forName("ac.grim.grimac.api.GrimUser",true,loader),ct=Class.forName("ac.grim.grimac.api.AbstractCheck",true,loader);
  Method uuid=ut.getMethod("getUniqueId"),name=ct.getMethod("getCheckName"),vl=ct.getMethod("getViolations");
  Object handler=Proxy.newProxyInstance(loader,new Class[]{ht},(o,m,a)->{
   if(!m.getName().equals("onFlag"))return objectMethod(o,m,a);
   boolean cancelled=(Boolean)a[3];
   if(!cancelled)try{String verbose=String.valueOf(((Supplier<?>)a[2]).get());mod.flag((UUID)uuid.invoke(a[0]),String.valueOf(name.invoke(a[1])),((Number)vl.invoke(a[1])).doubleValue(),verbose.substring(0,Math.min(verbose.length(),4096)));}catch(Exception e){ReplayMod.LOG.warn("Grim replay callback failed: {}",e.getClass().getSimpleName());}
   return cancelled;
  });
  channel.getClass().getMethod("onFlagSupplier",pluginType,ht).invoke(channel,plugin,handler);
  status="connected (public FlagEvent channel)";ReplayMod.LOG.info("Grim replay hook {}",status);
 }
 private static Class<?> findClass(ClassLoader loader,String... names)throws ClassNotFoundException{
  for(String n:names)try{return Class.forName(n,true,loader);}catch(Throwable ignored){}
  throw new ClassNotFoundException(Arrays.toString(names));
 }
 private static Object invokeAny(Object target,String method)throws Exception{
  for(Class<?> iface:target.getClass().getInterfaces()){
   try{Method m=iface.getMethod(method);m.setAccessible(true);return m.invoke(target);}catch(Throwable ignored){}
  }
  try{
   Class<?> abs=Class.forName("ac.grim.grimac.api.GrimAbstractAPI",true,target.getClass().getClassLoader());
   if(abs.isInstance(target)){Method m=abs.getMethod(method);m.setAccessible(true);return m.invoke(target);}
  }catch(Throwable ignored){}
  try{Method m=target.getClass().getMethod(method);m.setAccessible(true);return m.invoke(target);}catch(Throwable ignored){}
  for(Method m:target.getClass().getMethods())if(m.getName().equals(method)&&m.getParameterCount()==0){m.setAccessible(true);return m.invoke(target);}
  throw new NoSuchMethodException(method);
 }
 private static Object invokeOptional(Object target,String method){
  for(Class<?> iface:target.getClass().getInterfaces()){
   try{Method m=iface.getMethod(method);m.setAccessible(true);return m.invoke(target);}catch(Throwable ignored){}
  }
  try{Method m=target.getClass().getMethod(method);m.setAccessible(true);return m.invoke(target);}catch(Throwable ignored){}
  try{
   for(Method m:target.getClass().getMethods())if(m.getName().equals(method)&&m.getParameterCount()==0){m.setAccessible(true);return m.invoke(target);}
  }catch(Throwable ignored){}
  return null;
 }
 static Object objectMethod(Object o,Method m,Object[] a){return switch(m.getName()){case "toString"->"GrimReplayBridge";case "hashCode"->System.identityHashCode(o);case "equals"->o==a[0];default->null;};}
 public void close(){
  if(bus!=null&&plugin!=null){
   for(String name:List.of("unregisterAllListeners","unregisterListeners","unregister")){
    try{
     for(Method m:bus.getClass().getMethods()){
      if(m.getName().equals(name)&&m.getParameterCount()==1&&m.getParameterTypes()[0].isAssignableFrom(plugin.getClass())){m.invoke(bus,plugin);return;}
     }
    }catch(Throwable ignored){}
   }
  }
 }
}
