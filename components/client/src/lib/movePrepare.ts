import {destinationSettings} from "./moveAuthority";

export function readMovePrepare(value:unknown,generation:string,sourceChannelId:string,now=Date.now()) {
  if(!value || typeof value!=="object" || !generation || !sourceChannelId)return;
  const row=value as Record<string,unknown>;
  const policy=destinationSettings(row.channelSettings);
  const token=row.joinToken as {move_id?:unknown}|undefined;
  if(row.v!==1 || row.generation!==generation || typeof row.requestId!=="string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.requestId) ||
    row.sourceChannelId!==sourceChannelId || typeof row.destinationChannelId!=="string" || !row.destinationChannelId ||
    row.destinationChannelId.length>128 || row.destinationChannelId===sourceChannelId || !policy ||
    !token || token.move_id!==row.requestId || typeof row.expiresAt!=="number" || !Number.isFinite(row.expiresAt) ||
    row.expiresAt<=now || row.expiresAt>now+60000 || !Array.isArray(row.sfuUrls) || !row.sfuUrls.length || row.sfuUrls.length>16 ||
    row.sfuUrls.some(url=>typeof url!=="string" || !url || url.length>2048))return;
  return {requestId:row.requestId,sourceChannelId,destinationChannelId:row.destinationChannelId,joinToken:row.joinToken,
    sfuUrls:[...row.sfuUrls] as string[],expiresAt:row.expiresAt,channelSettings:{requirePushToTalk:policy.requirePTT,
      disableRnnoise:policy.disableRNNoise,maxBitrate:policy.maxBitrate,eSportsMode:policy.eSportsMode}};
}
