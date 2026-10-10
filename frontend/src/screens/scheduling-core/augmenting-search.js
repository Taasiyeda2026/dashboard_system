// Bounded multi-activity displacement. Branches are private copies: no partial
// chain is committed. Protected/out-of-scope rows are barriers, not victims.
export async function augmentingSearch({rows,targetId,optionsFor,blockersFor,canMove,toRow,checkpoint,maxDepth=3,branchLimit=24,maxBlockers=3}) {
  const place=async(id,current,path,depth)=>{
    await checkpoint();if(path.has(id))return null;
    const nextPath=new Set([...path,id]),without=new Map(current);without.delete(id);
    const options=await optionsFor(id,without);
    for(const option of options.slice(0,branchLimit)){
      await checkpoint();const blockers=await blockersFor(id,option,without);
      if(blockers===null||blockers.length>maxBlockers||blockers.some(b=>nextPath.has(b)||!canMove(b,current.get(b))))continue;
      if(blockers.length&&depth>=maxDepth)continue;
      let trial=new Map(without);for(const b of blockers)trial.delete(b);trial.set(id,toRow(id,option));
      let valid=true;for(const b of blockers){trial=await place(b,trial,nextPath,depth+1);if(!trial){valid=false;break;}}
      if(valid)return trial;
    }return null;
  };
  return place(targetId,new Map(rows),new Set(),0);
}
