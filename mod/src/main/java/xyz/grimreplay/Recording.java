package xyz.grimreplay;

import java.util.*;
import java.time.Instant;

/** Server-thread-owned ring; immutable section arrays can be shared with upload snapshots. */
final class Recording {
    record Section(int x,int z,int y,long tick,List<String> palette,int[] indices) {
        String key(){return x+":"+z+":"+y;}
        Map<String,Object> snapshot(long start){return Map.of("tick",Math.max(start,tick),"chunks",List.of(Map.of("x",x,"z",z,"sections",List.of(Map.of("y",y,"palette",palette,"indices",indices)))));}
        boolean same(Section s){return palette.equals(s.palette)&&Arrays.equals(indices,s.indices);}
    }
    record EntityMeta(String id,String type,String name,double width,double height) {}
    final UUID playerId; final String playerName, dimension;
    final ArrayDeque<Map<String,Object>> frames=new ArrayDeque<>();
    final LinkedHashMap<String,ArrayDeque<Section>> sections=new LinkedHashMap<>();
    final ArrayDeque<Map<String,Object>> changes=new ArrayDeque<>();
    final LinkedHashMap<String,EntityMeta> entityMeta=new LinkedHashMap<>();
    final LinkedHashMap<String,ArrayDeque<Map<String,Object>>> entityFrames=new LinkedHashMap<>();
    final ArrayDeque<Map<String,Object>> events=new ArrayDeque<>();
    final ArrayList<Map<String,Object>> flags=new ArrayList<>();
    final LinkedHashSet<String> warnings=new LinkedHashSet<>();
    long saveAt=-1, frozenStart=-1; int cursor; int versions; int lastHurtTime; boolean manual;
    Recording(UUID id,String name,String dimension){this.playerId=id;this.playerName=name;this.dimension=dimension;
        warnings.add("Server-authoritative movement; not the player's exact received world or Grim prediction.");
        warnings.add("Initial terrain is sampled incrementally; subsequent LevelChunk block mutations are captured after a section baseline exists. Direct section edits by other mods can bypass this hook. Snapshots are not atomic across chunks.");
        warnings.add("Only loaded chunks within the configured vertical range and entities within entityRadius are sampled; missing terrain is unknown.");
    }
    void recordEntity(String id,String type,String name,double width,double height,Map<String,Object> frame,RecorderConfig c){
        var history=entityFrames.get(id);
        if(history==null){
            if(entityFrames.size()>=c.maxEntities){
                var it=entityFrames.entrySet().iterator();
                if(it.hasNext()){var old=it.next();entityMeta.remove(old.getKey());it.remove();warnings.add("Tracked-entity limit reached; older entity trajectories were evicted.");}
            }
            history=new ArrayDeque<>();entityFrames.put(id,history);
        }
        entityMeta.put(id,new EntityMeta(id,type,name,width,height));
        long tick=((Number)frame.get("tick")).longValue();
        if(!history.isEmpty()&&((Number)history.getLast().get("tick")).longValue()>=tick)return;
        history.add(frame);
    }
    void recordEvent(Map<String,Object> ev,RecorderConfig c){
        if(events.size()>=c.maxEvents){warnings.add("Action-event limit reached; some interactions were omitted.");return;}
        events.add(ev);
    }
    void add(Section s,RecorderConfig c){
        var history=sections.get(s.key());
        if(history==null){
            if(sections.size()>=c.maxTrackedSections){var it=sections.entrySet().iterator();var old=it.next();versions-=old.getValue().size();it.remove();warnings.add("Tracked-section limit reached; older terrain was evicted.");}
            history=new ArrayDeque<>();sections.put(s.key(),history);
        }
        if(!history.isEmpty()&&history.getLast().same(s))return;
        history.add(s);versions++;
        while(versions>c.maxSectionVersions){
            String victim=null;long oldest=Long.MAX_VALUE;
            for(var e:sections.entrySet()) if(e.getValue().size()>1&&e.getValue().getFirst().tick()<oldest){oldest=e.getValue().getFirst().tick();victim=e.getKey();}
            if(victim==null)break;
            sections.get(victim).removeFirst();versions--;warnings.add("Section-version limit reached; some early terrain history is unavailable.");
        }
    }
    void trim(long cutoff){
        while(!frames.isEmpty()&&((Number)frames.getFirst().get("tick")).longValue()<cutoff)frames.removeFirst();
        for(var h:sections.values())while(h.size()>1){var it=h.iterator();it.next();if(it.next().tick()>cutoff)break;h.removeFirst();versions--;}
        while(!changes.isEmpty()&&((Number)changes.getFirst().get("tick")).longValue()<cutoff){
            var change=changes.removeFirst();int x=((Number)change.get("x")).intValue(),y=((Number)change.get("y")).intValue(),z=((Number)change.get("z")).intValue();
            var history=sections.get(Math.floorDiv(x,16)+":"+Math.floorDiv(z,16)+":"+Math.floorDiv(y,16));
            if(history!=null&&!history.isEmpty()){
                Section base=history.getFirst();long changed=((Number)change.get("tick")).longValue();
                if(base.tick()<=changed){
                    var palette=new ArrayList<>(base.palette());String state=(String)change.get("state");int id=palette.indexOf(state);if(id<0){id=palette.size();palette.add(state);}
                    int[] data=base.indices().clone();data[(y&15)*256+(z&15)*16+(x&15)]=id;
                    history.removeFirst();history.addFirst(new Section(base.x(),base.z(),base.y(),base.tick(),List.copyOf(palette),data));
                }
            }
        }
        flags.removeIf(f->((Number)f.get("tick")).longValue()<cutoff);
        while(!events.isEmpty()&&((Number)events.getFirst().get("tick")).longValue()<cutoff)events.removeFirst();
        for(var it=entityFrames.entrySet().iterator();it.hasNext();){
            var entry=it.next();var dq=entry.getValue();
            while(!dq.isEmpty()&&((Number)dq.getFirst().get("tick")).longValue()<cutoff)dq.removeFirst();
            if(dq.isEmpty()){entityMeta.remove(entry.getKey());it.remove();}
        }
    }
    Map<String,Object> bundle(String serverId,long now,String code){
        long start=frames.isEmpty()?now:((Number)frames.getFirst().get("tick")).longValue();
        var snaps=new ArrayList<Map<String,Object>>();
        for(var h:sections.values()){
            var it=h.iterator();
            if(it.hasNext())snaps.add(it.next().snapshot(start));
            while(it.hasNext()){var s=it.next();snaps.add(s.snapshot(s.tick()));}
        }
        snaps.sort(Comparator.comparingLong(s->((Number)s.get("tick")).longValue()));
        var entList=new ArrayList<Map<String,Object>>();
        for(var entry:entityFrames.entrySet()){
            var meta=entityMeta.get(entry.getKey());
            var validFrames=entry.getValue().stream().filter(f->{long t=((Number)f.get("tick")).longValue();return t>=start&&t<=now;}).toList();
            if(meta!=null&&!validFrames.isEmpty()){
                var em=new LinkedHashMap<String,Object>();
                em.put("id",meta.id());em.put("type",meta.type());em.put("name",meta.name());em.put("width",meta.width());em.put("height",meta.height());em.put("frames",validFrames);
                entList.add(em);
            }
        }
        var validEvents=events.stream().filter(ev->{long t=((Number)ev.get("tick")).longValue();return t>=start&&t<=now;}).toList();
        var out=new LinkedHashMap<String,Object>();
        out.put("schemaVersion",1);out.put("id",UUID.randomUUID().toString());out.put("serverId",serverId);out.put("createdAt",Instant.now().toString());
        out.put("player",Map.of("uuid",playerId.toString(),"name",playerName));out.put("dimension",dimension);out.put("startTick",start);out.put("endTick",now);out.put("tickRate",20);
        out.put("flags",new ArrayList<>(flags));var log=new LinkedHashMap<String,Object>();log.put("code",code);log.put("text",null);out.put("grimLog",log);
        out.put("snapshots",snaps);out.put("blockChanges",new ArrayList<>(changes));out.put("frames",new ArrayList<>(frames));out.put("entities",entList);out.put("events",validEvents);out.put("warnings",new ArrayList<>(warnings));return out;
    }
}
