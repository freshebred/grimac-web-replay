package xyz.grimreplay;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class RecordingTest {
 Recording recording(){return new Recording(UUID.randomUUID(),"Tester","minecraft:overworld");}
 Recording.Section section(long tick,String state){return new Recording.Section(0,0,4,tick,List.of(state),new int[4096]);}
 @Test void unchangedSectionsAreDeduplicated(){var r=recording();var c=new RecorderConfig();r.add(section(1,"minecraft:stone"),c);r.add(section(2,"minecraft:stone"),c);assertEquals(1,r.versions);}
 @Test void pruneKeepsBaselineAndAppliesHistoricalMutations(){var r=recording();var c=new RecorderConfig();r.add(section(1,"minecraft:air"),c);r.changes.add(Map.of("tick",2L,"x",1,"y",64,"z",2,"state","minecraft:stone"));r.trim(3);var base=r.sections.get("0:0:4").getFirst();assertEquals("minecraft:stone",base.palette().get(base.indices()[2*16+1]));assertTrue(r.changes.isEmpty());}
 @Test void pruneDoesNotOverwriteMoreRecentSnapshot(){var r=recording();var c=new RecorderConfig();r.add(section(1,"minecraft:air"),c);r.add(section(3,"minecraft:stone"),c);r.changes.add(Map.of("tick",2L,"x",1,"y",64,"z",2,"state","minecraft:dirt"));r.trim(4);assertEquals(1,r.versions);assertEquals("minecraft:stone",r.sections.get("0:0:4").getFirst().palette().getFirst());}
 @Test void boundedHistoryDoesNotGrowWithChangingTerrain(){var r=recording();var c=new RecorderConfig();c.maxSectionVersions=128;for(int i=0;i<1000;i++)r.add(section(i,"minecraft:block"+i),c);assertEquals(128,r.versions);assertTrue(r.warnings.stream().anyMatch(w->w.contains("limit")));}
 @Test void downloadedSnapshotIsNotChangedByRingPruning(){var r=recording();var c=new RecorderConfig();r.add(section(1,"minecraft:air"),c);var before=r.sections.get("0:0:4").getFirst();r.changes.add(Map.of("tick",2L,"x",0,"y",64,"z",0,"state","minecraft:stone"));r.trim(3);assertEquals("minecraft:air",before.palette().get(before.indices()[0]));}
 @Test void unsafeConfigIsRejected(){var c=new RecorderConfig();c.apiUrl="http://example.com";assertThrows(IllegalArgumentException.class,c::validate);c.apiUrl="https://example.com";c.maxTrackedSections=500;c.maxSectionVersions=128;assertThrows(IllegalArgumentException.class,c::validate);}
 @Test void entitiesAndEventsAreRecordedTrimmedAndExported(){
  var r=recording();var c=new RecorderConfig();c.maxEntities=2;
  r.frames.add(Map.of("tick",1L,"x",0.0,"y",64.0,"z",0.0,"yaw",0.0,"pitch",0.0,"pose","standing","onGround",true));
  r.frames.add(Map.of("tick",5L,"x",1.0,"y",64.0,"z",0.0,"yaw",0.0,"pitch",0.0,"pose","standing","onGround",true));
  r.recordEntity("e1","minecraft:player","Victim1",0.6,1.8,Map.of("tick",1L,"x",2.0,"y",64.0,"z",0.0,"yaw",90.0,"pitch",0.0,"hurt",false),c);
  r.recordEntity("e2","minecraft:zombie","Zombie",0.6,1.95,Map.of("tick",5L,"x",3.0,"y",64.0,"z",0.0,"yaw",0.0,"pitch",0.0,"hurt",true),c);
  r.recordEntity("e3","minecraft:skeleton","Skeleton",0.6,1.99,Map.of("tick",5L,"x",4.0,"y",64.0,"z",0.0,"yaw",0.0,"pitch",0.0,"hurt",false),c);
  r.recordEvent(Map.of("tick",1L,"type","swing","x",0,"y",64,"z",0),c);
  r.recordEvent(Map.of("tick",5L,"type","attack","targetId","e2","targetName","Zombie","distance",3.12),c);
  assertEquals(2,r.entityFrames.size());
  r.trim(3L);
  var b=r.bundle("srv",5L,null);
  var ents=(List<?>)b.get("entities");
  var evs=(List<?>)b.get("events");
  assertEquals(2,ents.size());
  assertEquals(1,evs.size());
 }
}
