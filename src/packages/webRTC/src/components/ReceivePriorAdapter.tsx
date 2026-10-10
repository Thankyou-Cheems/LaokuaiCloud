/* eslint-disable react-refresh/only-export-components -- Provider and consuming hook share the cache adapter. */
import { createContext, useContext } from "react";

export interface ReceivePriorActions {
  available:boolean;count:number;
  clearMember(host:string,member:string):void;
  clearAll():void;
}
const Context=createContext<ReceivePriorActions>({available:false,count:0,clearMember:()=>{},clearAll:()=>{}});
export const ReceivePriorProvider=Context.Provider;
export const useReceivePriors=()=>useContext(Context);
