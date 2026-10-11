/* eslint-disable react-refresh/only-export-components -- One provider and its read hook. */
import {createContext,useContext} from "react";

const Context=createContext(false);
/** Runtime value is only the SDK's post-publication speech boolean plus negative safety guards. */
export const TransmitSpeechProvider=Context.Provider;
export const useTransmitSpeech=()=>useContext(Context);
