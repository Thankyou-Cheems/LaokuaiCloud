import express, { type RequestHandler } from 'express';

import { ContractError } from './communityGrant';
import { parseCommunityGrantRequest, type CommunityGrantApi } from './communityGrantApi';

const ERROR_STATUS: Readonly<Record<string, number>> = {
  'auth-required':401,'auth-retired':401,'session-required':401,'session-retired':401,
  'membership-required':403,'community-forbidden':403,'auth-unavailable':503,
  'community-et-disabled':503,'native-activation-required':503,'invalid-community-et-request':400,'invalid-directory-query':400,
  'device-instance-mismatch':409,'device-instance-conflict':409,'address-pool-exhausted':409,
  'grant-operation-busy':409,'grant-operation-retired':409,'operation-retired':409,'unknown-grant':409,
  'reconciliation-required':409,'revocation-unconfirmed':409,'expired-grant':409,'binding-pending':409,
  'inactive-binding-grant':409,'binding-unproven':409,'provider-sample-conflict':409,
  'provider-observation-mismatch':409,'route-binding-mismatch':409,'duplicate-key-owner':409,
  'connection-evidence-conflict':409,'renewal-not-extended':409,
  'provider-incompatible':503,'issuer-store-unavailable':503,'native-readback-mismatch':503,
  'unsafe-native-policy':503,'native-key-mismatch':503,'grant-store-corrupt':503,
};
/** Owner mounts at /api/community-et after normal DB setup. This factory opens no
 * listener; no response projects a private grant into renderer/member state.
 */
export function createCommunityGrantRouter(api: CommunityGrantApi, rateLimit?: RequestHandler, enabled: () => boolean = ()=>true): express.Router {
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');next();});
  router.use((_req,res,next)=>{if (enabled() !== true) {res.status(503).json({v:1,error:'community-et-disabled'});return;}next();});
  if (rateLimit) router.use(rateLimit);
  router.use(express.json({limit:'4kb',strict:true}));
  for (const kind of ['session','acquire','renew','revoke','binding','directory'] as const) {
    router.post('/'+kind,(req,res)=>{
      void (async()=>{
        const header=req.headers.authorization;
        const bearer=typeof header === 'string' ? /^Bearer ([^\s]{1,8192})$/i.exec(header)?.[1] : undefined;
        if (!bearer) throw new ContractError('auth-required');
        let value: unknown;
        switch (kind) {
          case 'session':value=await api.session(bearer,parseCommunityGrantRequest('session',req.body));break;
          case 'acquire':value=await api.acquire(bearer,parseCommunityGrantRequest('acquire',req.body));break;
          case 'renew':value=await api.renew(bearer,parseCommunityGrantRequest('renew',req.body));break;
          case 'revoke':value=await api.revoke(bearer,parseCommunityGrantRequest('revoke',req.body));break;
          case 'binding':value=await api.binding(bearer,parseCommunityGrantRequest('binding',req.body));break;
          case 'directory':value=await api.directory(bearer,parseCommunityGrantRequest('directory',req.body));break;
        }
        res.status(200).json(value);
      })().catch(error=>{
        const code=error instanceof ContractError && Object.prototype.hasOwnProperty.call(ERROR_STATUS,error.code) ? error.code : 'community-et-unavailable';
        res.status(ERROR_STATUS[code]??503).json({v:1,error:code});
      });
    });
  }
  // Body parser messages may contain request text. Do not pass them to the global logger.
  router.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction)=>{
    const tooLarge=error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large';
    res.status(tooLarge?413:400).json({v:1,error:'invalid-community-et-request'});
  });
  return router;
}
