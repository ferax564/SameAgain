export type ShopperView='all'|'mine'|'unassigned'|string;

export function matchesShopper(item:{data:{assigned?:string;done?:boolean}},view:ShopperView,userId?:string){
 if(view==='all'||!view)return true;
 if(view==='mine')return item.data.assigned===userId;
 if(view==='unassigned')return !item.data.assigned;
 return item.data.assigned===view;
}

export function shopperTallies(items:{data:{assigned?:string;done?:boolean}}[],members:{user:string;name:string}[],userId?:string){
 const outstanding=items.filter(i=>!i.data.done);
 return {
  all:outstanding.length,
  mine:outstanding.filter(i=>i.data.assigned===userId).length,
  unassigned:outstanding.filter(i=>!i.data.assigned).length,
  members:members.map(m=>({user:m.user,name:m.name,count:outstanding.filter(i=>i.data.assigned===m.user).length})),
 };
}

export function claimAssignment(current:string|undefined,userId:string){
 if(!userId)return current||'';
 if(current&&current!==userId)return current;
 return current===userId?'':userId;
}
