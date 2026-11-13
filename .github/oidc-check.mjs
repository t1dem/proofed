// Test only: a real OIDC token of this job through the Worker's verifier, with GitHub's live keys.
import { actionsKey, verifyActionsToken } from "../site/src/worker/oidc.ts";

const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
url.searchParams.set("audience", "proofed");
const { value } = await (await fetch(url, { headers: { authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })).json();
console.log(`::add-mask::${value}`);
const [head, body, signature] = value.split(".");
console.log("header:", Buffer.from(head, "base64url").toString());
const claims = await verifyActionsToken(value, { audience: "proofed", key: actionsKey });
const pick = claims && Object.fromEntries(["iss", "aud", "repository", "repository_id", "event_name", "actor", "ref"].map((k) => [k, claims[k]]));
console.log("verified:", JSON.stringify(pick));
const otherAudience = await verifyActionsToken(value, { audience: "sts.amazonaws.com", key: actionsKey });
const flipped = signature.slice(0, 10) + (signature[10] === "A" ? "B" : "A") + signature.slice(11);
const tampered = await verifyActionsToken(`${head}.${body}.${flipped}`, { audience: "proofed", key: actionsKey });
console.log("other audience refused:", otherAudience === undefined, "· tampered signature refused:", tampered === undefined);
if (!claims || claims.repository !== process.env.GITHUB_REPOSITORY || String(claims.repository_id) !== process.env.GITHUB_REPOSITORY_ID || otherAudience || tampered) process.exit(1);
