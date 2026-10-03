import type { IncomingMessage,ServerResponse } from 'node:http';
import { z } from 'zod';
import { body,json,type ApiContext } from '../http.js';
export async function handleAuthRoute(context:ApiContext,req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const path=new URL(req.url!,'http://localhost').pathname;
 if(req.method==='GET'&&path==='/api/auth/session'){json(context,req,res,200,{authenticated:!!context.auth.authenticate(req),configured:context.auth.configured});return true;}
 if(req.method==='POST'&&path==='/api/auth/login'){
  const input=z.object({password:z.string().max(1024)}).strict().parse(await body(req));
  const cookie=context.auth.login(input.password,req.socket.remoteAddress||'unknown');res.setHeader('set-cookie',cookie.header);json(context,req,res,200,{authenticated:true,configured:true});return true;
 }
 if(req.method==='POST'&&path==='/api/auth/logout'){context.auth.logout(req);res.setHeader('set-cookie',context.auth.clearCookie);json(context,req,res,200,{authenticated:false,configured:context.auth.configured});return true;}
 return false;
}
