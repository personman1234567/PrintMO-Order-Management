// Small aggregate timings for the existing schedule report. No request bodies or credentials.
export async function measure(deps,group,name,operation){
 if(!deps?.timing)return operation();
 const start=performance.now();
 try{return await operation();}
 finally{
  const bucket=deps.timing[group] ||= {},entry=bucket[name] ||= {ms:0,count:0};
  entry.ms+=Math.round(performance.now()-start);entry.count++;
 }
}
export function noteBudget(timing,kind,cost,throttled=false){
 if(!timing||!cost)return;
 const entry=(timing.graphql ||= {})[kind] ||= {responses:0,requested:0,actual:0,throttled:0,minAvailable:null,restoreRate:null,maximumAvailable:null};
 entry.responses++;entry.requested+=cost.requestedQueryCost||0;entry.actual+=cost.actualQueryCost||0;
 if(throttled)entry.throttled++;
 const budget=cost.throttleStatus;
 if(Number.isFinite(budget?.currentlyAvailable))entry.minAvailable=entry.minAvailable===null?budget.currentlyAvailable:Math.min(entry.minAvailable,budget.currentlyAvailable);
 if(Number.isFinite(budget?.restoreRate))entry.restoreRate=budget.restoreRate;
 if(Number.isFinite(budget?.maximumAvailable))entry.maximumAvailable=budget.maximumAvailable;
}
