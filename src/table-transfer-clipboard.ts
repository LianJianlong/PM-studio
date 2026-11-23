import {useEffect,useState} from 'react';
type CopiedTable={id:string;name:string};
const key=(user:string)=>`project-studio:transfer-source:${user}`;
export function copyTableSource(user:string,table:CopiedTable){
 sessionStorage.setItem(key(user),JSON.stringify({id:table.id,name:table.name}));
 window.dispatchEvent(new Event('studio:table-transfer-clipboard'));
}
export function useTableSource(user:string){
 const [table,setTable]=useState<CopiedTable|null>(null);
 useEffect(()=>{
  const read=()=>{try{setTable(JSON.parse(sessionStorage.getItem(key(user))||'null'))}catch{setTable(null)}};
  read();window.addEventListener('studio:table-transfer-clipboard',read);
  return()=>window.removeEventListener('studio:table-transfer-clipboard',read);
 },[user]);
 return table;
}
