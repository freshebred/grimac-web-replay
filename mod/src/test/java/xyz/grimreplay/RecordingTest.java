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
}
