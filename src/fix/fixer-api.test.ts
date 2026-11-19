import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("the dashboard validates efforts and encrypts/syncs the Codex credential", () => {
  const script = `
    import assert from "node:assert/strict";
    import { createRequire, registerHooks } from "node:module";
    const sourceRoots = ${JSON.stringify([new URL("../../site/src/", import.meta.url).href, new URL("../", import.meta.url).href])};
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (sourceRoots.some(root => context.parentURL?.startsWith(root)) && specifier.startsWith(".") && !/\\.[a-z]+$/i.test(specifier)) specifier += ".ts";
      return nextResolve(specifier, context);
    }});
    const { handleApi, pushSecrets } = await import(${JSON.stringify(new URL("../../site/src/worker/api.ts", import.meta.url).href)});
    const { encrypt, decrypt } = await import(${JSON.stringify(new URL("../../site/src/worker/crypto.ts", import.meta.url).href)});
    const require = createRequire(${JSON.stringify(new URL("../../site/package.json", import.meta.url).href)});
    const nacl = require("tweetnacl");
    const { blake2b } = require("@noble/hashes/blake2.js");
    const repoKey = nacl.box.keyPair();
    const signing = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
    const secret = Buffer.alloc(32,7).toString("base64");
    const user = {id:1,login:"owner",token:await encrypt(secret,"github-token"),token_expires:Date.now()+3600000,claude_token:null,codex_key:null};
    const requests = [];
    const env = {
      SECRETS_KEY:secret,GITHUB_APP_ID:"1",GITHUB_APP_SLUG:"proofed-test",
      GITHUB_APP_PRIVATE_KEY:Buffer.from(await crypto.subtle.exportKey("pkcs8",signing.privateKey)).toString("base64"),
      DB:{prepare(sql){return {bind(...values){return {
        async first(){return user;},
        async run(){if(sql.includes("codex_key = ?")) user.codex_key=values[0];},
      };}};}},
    };
    globalThis.fetch = async (url,options) => {
      const path = new URL(url).pathname;
      requests.push({path,method:options.method,body:options.body && JSON.parse(options.body)});
      if(path.endsWith('/access_tokens')) return Response.json({token:'app-token',expires_at:new Date(Date.now()+3600000).toISOString()});
      if(path === '/user/installations') return Response.json({installations:[{id:7}]});
      if(path.endsWith('/repositories')) return Response.json({repositories:[{id:1,full_name:'owner/repo',permissions:{admin:true}}]});
      if(path.endsWith('/public-key')) return Response.json({key:Buffer.from(repoKey.publicKey).toString('base64'),key_id:'1'});
      if(path.includes('/actions/variables') || path.includes('/actions/secrets/')) return new Response(null,{status:204});
      throw new Error('Unexpected request: '+path);
    };
    async function post(path,body){return handleApi(new Request('https://proofed.test'+path,{method:'POST',headers:{cookie:'proofed_session=session'},body:JSON.stringify(body)}),env,path);}
    const path = '/api/repos/owner/repo/fixer';
    for(const body of [{provider:'codex',model:'gpt-6.1-sol',effort:'ultra'}, {model:'gpt-6-luna',effort:'max'}, {model:'claude-opus-5-1',effort:'high'}]) {
      const response = await post(path,body);
      assert.equal(response.status,200,JSON.stringify(await response.json()));
    }
    for(const body of [{provider:'claude',model:'gpt-6.1-sol',effort:'high'}, {model:'gpt-6-luna',effort:'ultra'}, {model:'gpt-invented',effort:'high'}, {model:'claude-opus-5-5',effort:'ultra'}]) assert.equal((await post(path,body)).status,400);
    const key='sk-proofed-test-key-not-a-real-credential';
    const saved=await post('/api/keys',{codexKey:key});
    assert.equal(saved.status,200);
    assert.deepEqual(await saved.json(),{ok:true,synced:1,of:1});
    assert.notEqual(user.codex_key,key);
    assert.equal(await decrypt(secret,user.codex_key),key);
    const pushed=requests.find(r=>r.path.endsWith('/secrets/CODEX_API_KEY'));
    assert.ok(pushed);
    assert.equal(pushed.method, 'PUT');
    assert.equal(pushed.body?.key_id, '1');
    assert.equal(typeof pushed.body?.encrypted_value, 'string');
    const sealed = Buffer.from(pushed.body.encrypted_value, 'base64');
    const sender = sealed.subarray(0, nacl.box.publicKeyLength);
    const nonce = blake2b(Buffer.concat([sender, repoKey.publicKey]), {dkLen:nacl.box.nonceLength});
    const opened = nacl.box.open(sealed.subarray(sender.length), nonce, sender, repoKey.secretKey);
    assert.ok(opened);
    assert.equal(new TextDecoder().decode(opened), key);
    assert.equal(JSON.stringify(pushed).includes(key),false);
    const me=await handleApi(new Request('https://proofed.test/api/me',{headers:{cookie:'proofed_session=session'}}),env,'/api/me');
    assert.equal((await me.json()).codex,true);
    const full = {...user, lt_username:'test-user', lt_key:await encrypt(secret,'test-key'), claude_token:await encrypt(secret,'test-claude')};
    const previousFetch = globalThis.fetch;
    let active = 0;
    let peak = 0;
    globalThis.fetch = async (url, options) => {
      if (options.method === 'PUT' && String(url).includes('/actions/secrets/')) {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 25));
        active--;
      }
      return previousFetch(url, options);
    };
    const started = performance.now();
    assert.deepEqual(await pushSecrets(env, full, 'owner/repo', 7), ['LT_USERNAME','LT_ACCESS_KEY','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY']);
    console.log('Four secret PUTs, 25 ms mock latency each: '+(performance.now()-started).toFixed(1)+' ms, peak '+peak);
    assert.equal(active, 0);
    assert.equal(peak, 4);

  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {encoding:"utf8"});
  console.log(run.stdout.trim());
  assert.equal(run.status,0,run.stderr+run.stdout);
});
