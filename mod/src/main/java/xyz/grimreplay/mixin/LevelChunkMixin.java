package xyz.grimreplay.mixin;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import xyz.grimreplay.ReplayMod;
@Mixin(LevelChunk.class)
public abstract class LevelChunkMixin {
 @Inject(method="setBlockState",at=@At("RETURN"))
 private void replay$changed(BlockPos pos,BlockState state,int flags,CallbackInfoReturnable<BlockState> result){
  if(result.getReturnValue()!=null&&result.getReturnValue()!=state&&ReplayMod.INSTANCE!=null)
   ReplayMod.INSTANCE.blockChanged(((LevelChunk)(Object)this).getLevel(),pos,state);
 }
}
