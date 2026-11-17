// Public demo-store #14 reports, copied from the proofed-clips run files.
// Initial: https://github.com/t1dem/proofed-demo-store/pull/14#issuecomment-6916248939
// Fixed: https://github.com/t1dem/proofed-demo-store/pull/14#issuecomment-6916376137
// /try/14?demo reads these without API requests or starting a paid run.
import type { PullDetail, Run } from "../worker/runs";
import type { TryView } from "../worker/try";
import { fixedSummary } from "../run-summary";

const runs: Run[] = [
  {
    "sha": "dce55273adf52b7074db7ff0157febf609125bce",
    "runUrl": "https://github.com/t1dem/proofed-demo-store/actions/runs/43865152790",
    "skipped": [],
    "scenarios": [
      {
        "id": "checkout",
        "name": "Place an order",
        "outcome": "unsure",
        "reason": "The confirmation page lacks the required coffee, shipping, and bag-total details.",
        "diagnosis": "The check treated the confirmation page as if it had to repeat the coffee price, shipping price, and bag total separately. The stated outcome only required confirmation that the order was in and that €17.90 was charged; the page showed both.",
        "suggestion": "Update the confirmation assertion to require the order-in message and the charged €17.90 amount. Keep the coffee and shipping breakdown check on the bag or checkout page, where those details are displayed.",
        "steps": [
          {
            "remark": "navigate: Navigate to http://localhost:4173/",
            "at": 0
          },
          {
            "remark": "click: Clicking Add Colombia Huila to bag",
            "at": 1
          },
          {
            "remark": "click: Clicking Bag (1) to open the bag",
            "at": 2.5
          },
          {
            "remark": "click: Clicking Checkout link in the order summary",
            "at": 4.1
          },
          {
            "remark": "wait: queued plan (5 steps): type \"Full name\"; type \"Email\"; type \"Street address\"; ty",
            "at": 5.7
          },
          {
            "remark": "type: Type \"Ada Lovelace\" into \"Full name\"",
            "at": 6
          },
          {
            "remark": "type: Type \"ada@example.com\" into \"Email\"",
            "at": 6.8
          },
          {
            "remark": "wait: queued plan (3 steps): type \"Street address\"; type \"City\"; click \"Place order\"",
            "at": 8.1
          },
          {
            "remark": "type: Type \"12 Rua Augusta\" into \"Street address\"",
            "at": 8.3
          },
          {
            "remark": "type: Typing Lisbon in the city field",
            "at": 9.6
          },
          {
            "remark": "click: Clicking Place order button in checkout order summary",
            "at": 11.2
          },
          {
            "remark": "wait: PRIMARY: wait for the order confirmation heading to load",
            "at": 12.8
          },
          {
            "remark": "analyze: the total the bag showed was €17.90",
            "at": 12.8
          },
          {
            "remark": "wait: Waiting after failed confirmation verification",
            "failed": true,
            "at": 12.8
          }
        ],
        "clip": {
          "gif": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/checkout.gif",
          "mp4": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/checkout.mp4",
          "jpg": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/checkout.jpg"
        },
        "credits": 20.695115,
        "seconds": 147
      },
      {
        "id": "free-shipping",
        "name": "Free shipping from €50",
        "outcome": "passed",
        "reason": "Added House Espresso and Paper Filters to the bag, then opened the bag.\nThe bag initially showed €4.90 shipping and a €49.40 total.\nPressed the + control next to Paper Filters once.\nThe updated bag showed Free shipping and a €51.00 total.",
        "steps": [
          {
            "remark": "navigate: Navigate to http://localhost:4173/",
            "at": 0
          },
          {
            "remark": "wait: queued plan (2 steps): click \"Add House Espresso to bag\"; click \"Add Paper Filte",
            "at": 1
          },
          {
            "remark": "click: Click \"Add House Espresso to bag\"",
            "at": 1.3
          },
          {
            "remark": "scroll: Scroll \"Add Paper Filters to bag\" into view",
            "at": 2.6
          },
          {
            "remark": "click: Click \"Add Paper Filters to bag\"",
            "at": 3.2
          },
          {
            "remark": "scroll: Scrolling to Bag (2) in the header",
            "at": 4.5
          },
          {
            "remark": "click: Clicking Bag (2)",
            "at": 6.1
          },
          {
            "remark": "wait: PRIMARY: wait for the bag page to load",
            "at": 7.4
          },
          {
            "remark": "analyze: the total is €49.40",
            "at": 7.4
          },
          {
            "remark": "assert: shipping is €4.90 and the total is €49.40",
            "at": 7.4
          },
          {
            "remark": "click: Clicking Add one more Paper Filters next to quantity",
            "at": 7.4
          },
          {
            "remark": "analyze: the total is €51.00",
            "at": 8.9
          },
          {
            "remark": "assert: shipping is now Free and the total is €51.00",
            "at": 8.9
          }
        ],
        "clip": {
          "gif": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/free-shipping.gif",
          "mp4": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/free-shipping.mp4",
          "jpg": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/free-shipping.jpg"
        },
        "credits": 22.971513499999997,
        "seconds": 103
      },
      {
        "id": "promo-code",
        "name": "Promo code total",
        "outcome": "passed",
        "reason": "Added Ethiopia Guji to the bag twice and added one Hand Grinder.\nOpened the bag and applied the lowercase promo code welcome10.\nThe promo code was applied successfully: the discount is −€9.10, shipping is Free, and the total is €81.90.",
        "steps": [
          {
            "remark": "navigate: Navigate to http://localhost:4173/",
            "at": 0
          },
          {
            "remark": "click: Clicking Add Ethiopia Guji to bag twice",
            "at": 1
          },
          {
            "remark": "click: Clicking Add Ethiopia Guji to bag button twice",
            "at": 2.5
          },
          {
            "remark": "click: Clicking Add Hand Grinder to bag",
            "at": 4.1
          },
          {
            "remark": "click: Clicking Bag (3)",
            "at": 5.6
          },
          {
            "remark": "wait: queued plan (2 steps): type \"Promo code\"; click \"Apply\"",
            "at": 7.2
          },
          {
            "remark": "type: Type \"welcome10\" into \"Promo code\"",
            "at": 7.5
          },
          {
            "remark": "click: Clicking Apply to apply the promo code",
            "at": 8.8
          },
          {
            "remark": "analyze: the total is €81.90",
            "at": 10.4
          },
          {
            "remark": "assert: the discount is −€9.10, shipping is Free and the total is €81.90",
            "at": 10.4
          }
        ],
        "clip": {
          "gif": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/promo-code.gif",
          "mp4": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/promo-code.mp4",
          "jpg": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/dce5527-43865152790/promo-code.jpg"
        },
        "credits": 18.253739999999997,
        "seconds": 92
      }
    ],
    "fix": {
      "status": "fixed",
      "model": "claude-haiku-5-5",
      "effort": "xhigh",
      "summary": "promoPercent stopped trimming and uppercasing the entered code, so lowercase promo codes like welcome10 were rejected; the bag now trims and uppercases the code when it is applied, and the simplified lookup is kept.",
      "commit": "dce55273adf52b7074db7ff0157febf609125bce",
      "attempts": [
        {
          "summary": "promoPercent stopped trimming and uppercasing the entered code, so lowercase promo codes like welcome10 were rejected; the bag now trims and uppercases the code when it is applied, and the simplified lookup is kept.",
          "result": "Kane saw it pass."
        }
      ],
      "files": [
        {
          "path": "src/pages/Cart.tsx",
          "added": 3,
          "removed": 2
        }
      ]
    },
    "key": "pr-14/dce5527-43865152790",
    "at": 1794831977000
  },
  {
    "sha": "d2be5b3b506df0d8b15dede0c44847fc86a11cc2",
    "runUrl": "https://github.com/t1dem/proofed-demo-store/actions/runs/43865152790",
    "skipped": [],
    "scenarios": [
      {
        "id": "checkout",
        "name": "Place an order",
        "outcome": "unsure",
        "reason": "The required confirmation breakdown values are absent from the confirmation and saved order record.",
        "diagnosis": "The test treated the confirmation page as if it had to repeat the coffee and shipping line items. The stated check only requires the order-confirmed message and the €17.90 charge, both of which are present.",
        "suggestion": "Update the confirmation assertion to require the order-in message and the €17.90 charged total. Keep the €13.00 subtotal and €4.90 shipping checks on the bag or checkout page unless the product requirement explicitly requires a confirmation-page breakdown.",
        "steps": [
          {
            "remark": "navigate: Navigate to http://localhost:4173/",
            "at": 0
          },
          {
            "remark": "click: Clicking Add Colombia Huila to bag",
            "at": 1
          },
          {
            "remark": "click: Clicking Bag (1)",
            "at": 2.5
          },
          {
            "remark": "click: Clicking Checkout in the shopping bag summary",
            "at": 4.1
          },
          {
            "remark": "wait: queued plan (5 steps): type \"Full name\"; type \"Email\"; type \"Street address\"; ty",
            "at": 5.7
          },
          {
            "remark": "type: Type \"Ada Lovelace\" into \"Full name\"",
            "at": 6
          },
          {
            "remark": "type: Type \"ada@example.com\" into \"Email\"",
            "at": 6.9
          },
          {
            "remark": "wait: queued plan (3 steps): type \"Street address\"; type \"City\"; click \"Place order\"",
            "at": 8.2
          },
          {
            "remark": "type: Type \"12 Rua Augusta\" into \"Street address\"",
            "at": 8.5
          },
          {
            "remark": "type: Typing Lisbon in city field",
            "at": 9.8
          },
          {
            "remark": "click: Clicking Place order button",
            "at": 11.3
          },
          {
            "remark": "wait: PRIMARY: wait for the order confirmation heading to load",
            "at": 12.9
          },
          {
            "remark": "analyze: €17.90 is the total the bag showed",
            "at": 12.9
          },
          {
            "remark": "wait: Waiting after checkpoint failure",
            "failed": true,
            "at": 12.9
          }
        ],
        "clip": {
          "gif": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/checkout.gif",
          "mp4": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/checkout.mp4",
          "jpg": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/checkout.jpg"
        },
        "credits": 42.7548575,
        "seconds": 159
      },
      {
        "id": "free-shipping",
        "name": "Free shipping from €50",
        "outcome": "passed",
        "reason": "Added House Espresso and Paper Filters to the bag and opened the bag page.\nConfirmed the order summary showed €4.90 shipping and a €49.40 total.\nIncreased the Paper Filters quantity by one.\nThe updated order summary showed free shipping and a €51.00 total.",
        "steps": [
          {
            "remark": "navigate: Navigate to http://localhost:4173/",
            "at": 0
          },
          {
            "remark": "click: Clicking Add House Espresso to bag and opening the bag",
            "at": 1
          },
          {
            "remark": "scroll: Scrolling to Add Paper Filters to bag button",
            "at": 2.5
          },
          {
            "remark": "click: Clicking Add Paper Filters to bag",
            "at": 4.2
          },
          {
            "remark": "scroll: Scrolling the Bag section into view",
            "at": 5.4
          },
          {
            "remark": "click: Clicking Bag (2) in the top-right header",
            "at": 7.1
          },
          {
            "remark": "analyze: the total is €49.40.",
            "at": 8.3
          },
          {
            "remark": "assert: shipping is €4.90 and the total is €49.40.",
            "at": 8.3
          },
          {
            "remark": "click: Clicking Add one more Paper Filters",
            "at": 8.3
          },
          {
            "remark": "analyze: the total is €51.00.",
            "at": 9.9
          },
          {
            "remark": "assert: shipping is now Free and the total is €51.00.",
            "at": 9.9
          }
        ],
        "clip": {
          "gif": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/free-shipping.gif",
          "mp4": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/free-shipping.mp4",
          "jpg": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/free-shipping.jpg"
        },
        "credits": 25.613232500000002,
        "seconds": 98
      },
      {
        "id": "promo-code",
        "name": "Promo code total",
        "outcome": "failed",
        "reason": "The entered welcome10 code returned “That code doesn't work,” leaving total €91.00 rather than the required discounted total.",
        "diagnosis": "The bag does not accept the valid lowercase promo code required for this order.",
        "suggestion": "Make the required lowercase code welcome10 apply the €9.10 discount, show Free shipping, and update the total to €81.90.",
        "steps": [
          {
            "remark": "navigate: Navigate to http://localhost:4173/",
            "at": 0
          },
          {
            "remark": "click: Clicking Add Ethiopia Guji to the bag",
            "at": 1
          },
          {
            "remark": "click: Clicking Add Ethiopia Guji to the bag",
            "at": 2.5
          },
          {
            "remark": "click: Adding the Hand Grinder to the bag",
            "at": 4.1
          },
          {
            "remark": "click: Clicking Bag (3) in the top right header",
            "at": 5.6
          },
          {
            "remark": "wait: queued plan (2 steps): type \"Promo code\"; click \"Apply\"",
            "at": 7.2
          },
          {
            "remark": "type: Type \"welcome10\" into \"Promo code\"",
            "at": 7.5
          },
          {
            "remark": "click: Clicking Apply button in order summary promo form",
            "at": 8.8
          },
          {
            "remark": "wait: Waiting after applying the promo code",
            "failed": true,
            "at": 10.4
          }
        ],
        "clip": {
          "gif": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/promo-code.gif",
          "mp4": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/promo-code.mp4",
          "jpg": "https://github.com/t1dem/proofed-demo-store/raw/proofed-clips/pr-14/d2be5b3-43865152790/promo-code.jpg"
        },
        "credits": 22.527432499999996,
        "seconds": 118
      }
    ],
    "key": "pr-14/d2be5b3-43865152790",
    "at": 1794831636000
  }
];

export const detail: PullDetail = {
  pull: {
    repo: "t1dem/proofed-demo-store", pr: 14, title: "Simplify promo code lookup",
    state: "passing", headline: "2 of 3 scenarios pass in a real browser; 1 wasn't checked.",
    url: "https://github.com/t1dem/proofed-demo-store/pull/14", updatedAt: runs[0]!.at,
    scenarios: runs[0]!.scenarios.map(({ name, outcome, reason }) => ({ name, outcome, reason })),
    fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", attempts: 1 },
  },
  runs,
};

export const view: TryView = {
  repo: detail.pull.repo, provider: "Claude", bugs: [], current: null, left: 0,
  recent: [{ pr: 14, bug: "promo-lookup", title: detail.pull.title!, startedAt: runs[1]!.at,
    finishedAt: runs[0]!.at, state: "passing", fixed: true, unsure: true,
    model: "claude-haiku-5-5", result: fixedSummary(runs, "Claude") }],
};
