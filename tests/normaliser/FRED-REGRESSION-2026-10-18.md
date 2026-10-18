# Fred — Normaliser regression test results

**Tested:** 18 October 2026  
**Repository:** TabAPIvbeta2  
**Component:** `local-normaliser/normaliser.py` (CSV sample client; separate from the Kubrick backend)  
**Evidence:** User-run Windows console logs for Fred's August and September CSV exports.

This is a **manual end-to-end regression record**, not an automated test suite. An accepted canonical payload and Kubrick READY indicate technical success, **not** independent reconciliation of all runner facts or source CSV payouts. Signed CloudFront recap URLs were copied from the test logs; they are time-limited.

## Overview

**75** source bet components over **12** tested racing days: **63 Kubrick-ready (84%)**, **9 quarantined**, **3 excluded** before finalisation. Eleven days produced Kubrick READY; 13 September did not submit. Exclusion counts refer to components rather than source transactions.

## Daily results

| Racing day | Meetings | Source bets | Ready | Excluded | Quarantined | Kubrick validation | Recap |
|---|---|---:|---:|---:|---:|---|---|
| Saturday 19 Sep 2026 | Randwick R2/R4; Caulfield R6/R7/R9 | 12 | 12 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/07169263-9853-4f15-b4a0-47d498a9f174/recap.html?Expires=1823823879&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=JEStwfp0YPxsSuGa1W22J1g12hXvGoIwinQGXsOUqHqN5Q052B~KQEM5BuluxYL4awH8LT30YB8guVhS5d4uKna~xnOtzA5QvzLvkAmPo8RbPHNgTcalCsYigZgmcswRFXOpk1UWvFkCsl7kzeb34X~7slrIG-fcKCnjajN7p2x7wLwBmNTufcpARbVm3mGFH7k3oAEWfFiEWQoimE9BUv2rR9Ve2BLxfO73kRNWeuN7PvTDN3E4eidBOd3hJ0CXx6ymwqweOfr2qDBsq7W4gz~RkXz9B98FEAWkhBNN06vL-TY2DHCR~cUbFVfPvPUpO3PgDEF~vCmSYce1qC8MPg__) |
| Friday 18 Sep 2026 | Newcastle R8 | 3 | 3 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/03e96e8d-7696-4f12-b404-c3bdae02a40d/recap.html?Expires=1823823904&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=ZcY36Xs-8UmD-8yOdK2Xl3q6yOEoOlZb8VhwxRuaERrlr4ztwEuarbsBSgtYnF0~ET71bYsmZF21rDz004UUIXSPykNhf3iKX~Aj3bMN-SxLQpK8IWqg74n1ujdQ~DKdIh5g1-oF22T9eu9m1Qdzt7FK3KdXF4MblI3tJbVD37CSCSpI4UdtzQVsZMyeOOxIwip9cPlKOe4YZzTEhtnmtMwQBqd-f30PlXqPH6U~MyPEcWKQvXjQ2a82-ho9lPRmmF8LGeQbxQTTBaTYMxx7DpmwVKYw4s4Qx3MNNE~BFl0Rs6WcPvm~t6KsbHD1IrYm1ZjagGvfi9Bhx1xKue~Kog__) |
| Sunday 13 Sep 2026 | Bathurst R1; Istanbul R2 | 3 | 0 | 0 | 3 | **FULL FAILURE** | No recap — not submitted |
| Friday 11 Sep 2026 | Goulburn R5 | 3 | 3 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/1c2547fe-2afa-4c3b-9e6a-257dcbbca425/recap.html?Expires=1823823975&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=MbUCYXFARY8wDPyIxkzFGJ2JXPnoGkv1VyEJhwWiq231sREe-nWAy~ZpcZyViCwI-bL1rmSzgAQGlo8aXUPXpc-1hlv6imqHPzOHVVqfRa~pzXVtf0r~kSAGuBdJgZCnr40YKQKunKFhEWeCdtifyu3y84yp9tmA9x72bzU8iA9aFz4RdCiySfCGkhoQXRwy6tBMn3XIc0sL~Btt4f5Q6zUJKpxeaXZOUEITUuTZwG99Qt95bwyoGTJ0VNFy-C8AldTIsnwk7FUZLzlxB4KDpjh4pElzzkcFiDdwF5qlB2wxHc4GwLetjOEk0mpC9MitF51aQP~8EkDTuzkqySzSqg__) |
| Monday 07 Sep 2026 | Tatura R6; Dubbo R6/R7; Pinjarra R6; Warrnam R10 | 8 | 6 | 1 | 1 | **PARTIAL FAILURE** | [View recap](https://d2bs94wi893l8l.cloudfront.net/77a46a8c-6f26-482f-848b-1ccb50fd3ffe/recap.html?Expires=1823824004&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=gAEkkkGpBNhNCwzJCHvpYixCy6Hnyp44R04y73eMHrVsclobXaVxjOEIeqeMA-Ie8Tmh84XvP~F7LUKlGs3ca~zr3QQ0jGjx9OCQR8wNiJZABOk5ghbS5qaA5bdhAi0Aj4Oo4EeFAJG6O7oKNWGzRnYxr2O~nr5qoeUQPt2TAtbyGj0425M37f5koCqUq990IjpXVQHq~WFNkL2zY2iWCHfwLQYbXqktZb5lWu9Ke2SOyGdVzjUJ6n02G13Du28WWG71DZJWstWoA3tFSRUakqsSUH8~9LOjsDDLQbA8se8YQ2U5ssm1Bgm4Qfonp6qZyYRLrivA~IoQATExnXYEgQ__) |
| Thursday 27 Aug 2026 | Wagga R8; Carlisle R1 | 5 | 5 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/5281b190-1fbd-476c-b49e-6db210f10f96/recap.html?Expires=1823824027&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=d6lva434ftieGsOBbJQWiY65OGNsGv7WOVBX4gyiFprSoEHv2TvkVmzjNwDUl1VZofumiEZttM2~fndg8YK1tIVeEgUK4yTbBLQMBIRRRgmBWQwHkL3RE9v4mv~k1Sr~iz6tTcUAq10OTrV0E7p6lUItD9hH67vkugIkHmpZXwbhVDl82ZWRVLokF4gK8cNgApCt6bnFX9M3AjlPOFGrrRekfRd58ZANRQ29~uV7Eq2a4TwJMijr9gucz6P2HKcZmDuLfP8REcsG~hym6YWbH2ve-wuSwdROaYDQHRwJXbCUv68cmMFiLCgaW2opqd~hzWj6NYGW-jxczdB6X-8-Fw__) |
| Wednesday 26 Aug 2026 | Bathurst R3; Belmont R7 | 3 | 2 | 1 | 0 | **PARTIAL FAILURE** | [View recap](https://d2bs94wi893l8l.cloudfront.net/b525537d-d765-487f-8487-c31d660f7afe/recap.html?Expires=1823824066&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=xl7OgIDQaubPKF~imuEzkeH34LnCnmHme6cjPtEtPbU2gkbFSUVdNeYkodnelcWvLwDMdxRP~u0uWmSFNxUoKTp1yo2CC5BtA0StejG5vy3kjhoYBQX6bX3CxkL~Q0f2ZKFE8U~9U03SEPJVFRjGwGgHaW0x9EGG9I7NudmjsEpJKzY-PGUJl3ctqAWY3Ju65DPhqhsT4jeikOxefAG~obVOWdRoZW5-C8Ca426aXZaT7k4BInK3s48IT0~jFGQjz~I03zXEB5U3u1sCtQ7Af9ZlNkfTndyivXP0PuQwWOJKAcKbMvVnTaYFo-OXNLZ4gLp80J321OmSwbhx9f4vXg__) |
| Saturday 22 Aug 2026 | Randwick R3/R6/R10 | 4 | 4 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/c7ed0d9c-ae88-4281-94a1-59f38e0f409b/recap.html?Expires=1823824103&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=R80m7nnU8i14bTFHVPDmVWck~MNsmGCHlKtQvX8iQ3NmlFM35r4GysKCujkS5lQQ8IiP00BZe~JdN0fwLSUbL83o-3urkL3WBxPk3iuVc~CrwXPcp52dvHtICzvy0aehRY9MwFsi1X1ftfzG-aytSVnSfl0kQxy9WyenQ25rJsrwzVAgqX89AxBa5438ykbxkBOuJhnDBOVTAcuuwuB3xwjjaEE5Wf-~W5puTargmEBZGLNvL9TtmkohEx9HHdTKsX5iDh2aTIoyniHjURgtOiHbIp9yIGlj8CrwpOCseCBvjuXfx8cCP3WMOTanKFK68ajef~K7ZklW0XtOqs8rsA__) |
| Saturday 15 Aug 2026 | Caulfield R2/R7; Broome R7 | 4 | 2 | 0 | 2 | **PARTIAL FAILURE** | [View recap](https://d2bs94wi893l8l.cloudfront.net/49e75a93-b915-457d-b0b0-aefa8521d9c5/recap.html?Expires=1823824141&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=fZxPRHJKhgzXGHLKPuLauyYMJR3LPyXDKhEGAQ~kW4DCz0hgaB20QRUQvN0cRnvlb03Mhb6Edq~l48JhURkLBroEhdSsVEytjuez7KzGGGRgUzts6Ak6L5Ti1y-e8N~CpRW5LYBIprc6JK6Hym-SYUUh-t3uoOM5NAGg8cQRS955zEe1FBpIJB-y-Y1MuKLe0F93EViuRq-SO0StIDSvf21pCHmYIvuOBpyTLvJBwsdZVQbg5Xpirz1~PO-b4GNeAp34o4nHvjlZYVjptMhr2Azaz2WSt75bf3lGfnYDeKH-i4yfEK4ENPNji0azMzhPoe2pZ9DC9pTvsxLfSnwPwA__) |
| Friday 14 Aug 2026 | Gunnedah R3/R4/R7; Ipswich R3; Geelong R7 | 8 | 4 | 1 | 3 | **PARTIAL FAILURE** | [View recap](https://d2bs94wi893l8l.cloudfront.net/b4fe018e-0b42-4fdf-99bd-d5af45426c28/recap.html?Expires=1823824195&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=zri-MjaoR9QHbcnHCIDFX6NzITMLFWWDAVZrN4JK5OEK9UDEU7Zc9jxNNUZhSB1VojwC5BPvFO1kYeqLnujE0G0cwigr~~Wa5DutV~XATSLbmqc4BnxKe0DQ2SCXs-P2PU4rBO2iHnmsyeDhgGeFWK8WFFQ7YxAa6n2K333oqH7jSOX0UUIorelx6cPyGOqMNryRvFUgxyJSQh4owaDPoNY-EjxRlM01uwVc4dGzmYFNGhYz7lvkgZjqlb8C~9f8RC107LtmIph0ORCKz8Em672ykU5FYbnlcClHpkQlxlnqYOyUEFwkkY-yI7jZx4sPcaxyPsGoat5bhkqHI3RJEg__) |
| Thursday 13 Aug 2026 | Newcastle R5/R6/R7/R8; Bunbury R2/R4/R6; Moe R6; Rockhampton R5 | 18 | 18 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/f2225e5f-7775-49b0-b25a-1db1d44d3b1f/recap.html?Expires=1823824240&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=g~yB-lFiTZM1abzmMVXQBeZlleQtEnN~FEYwPeqK6c-O4WDjBPnRC8PXGp96b3LAFxq2wFbtGdJI-KAqKAZ2ur46oHEj9if1rPwTXpg9yHQbhzWFW2rQ7ggiQzm51lVVgOqJp7IBKXta4e9ptdSODRsVT8hjWOiXoJ~e6aiSr~JJDJXMt55-mcahMc4WIXcJDX0TeGpjGOg0fe5c9tr1u9wA4~ZoZHvZr7puBHL5DwyZPPtLC9gIGHmUCNuRJptRqn6tZlbG5U-G9UukgNU29w--ZxOt2Xr9EIsNSl4afiiqrBx6jle8JDO5SAhTLsDbxo2qThemLVnpu5-W9StR-Q__) |
| Saturday 08 Aug 2026 | Randwick R10 | 4 | 4 | 0 | 0 | **PASS** | [View recap](https://d2bs94wi893l8l.cloudfront.net/faaf839e-3a5f-4ac1-9e4b-67861f7bd739/recap.html?Expires=1823824262&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=BerDK7aTmzyJeoyrhBhDQbPwTNqsKAPmlq76~Zj1ObtOLE6q~-cJnK4xKXbEtLFQ2-XztuA9gPGZ6fdG36LobV1rfkf~NPDSfSXTzHlrR3n-rgQX9ypNL2NXlUMMFwGhy9~JeQfMP32uyR3VEVgXXwDncDyKHb3Jiq2CuO7GihOBuoVXpK1T3H3GbypKhvIpkSnDm7B6uqSQqJXIA9kKj0yDFg7EOAuaMzgJJVhDpClv8EfDxIrdVXqR6Zu2FAx-gebxSA6zHqidZahtzez-xBZQvfgJMf2Q7eCnIVYd9~HuaLYk6uDKs0T6Oj9Nl9Wu5zg6F8XJViv25GlgzPF~mA__) |

**Validation terms:** PASS = all source components included and canonical payload valid; PARTIAL FAILURE = some source components quarantined or excluded but surviving payload valid; FULL FAILURE = no valid transactions available to submit. The validator output may say 'valid' for a partial-day payload: that does not mean the original day is complete.

## Detailed day-by-day findings

### Saturday 19 Sep 2026

- **Races:** Randwick R2/R4; Caulfield R6/R7/R9
- **Results:** 12 source bet components; 12 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $310.00 · Returned $210.00 · Net $-100.00. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/07169263-9853-4f15-b4a0-47d498a9f174/recap.html?Expires=1823823879&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=JEStwfp0YPxsSuGa1W22J1g12hXvGoIwinQGXsOUqHqN5Q052B~KQEM5BuluxYL4awH8LT30YB8guVhS5d4uKna~xnOtzA5QvzLvkAmPo8RbPHNgTcalCsYigZgmcswRFXOpk1UWvFkCsl7kzeb34X~7slrIG-fcKCnjajN7p2x7wLwBmNTufcpARbVm3mGFH7k3oAEWfFiEWQoimE9BUv2rR9Ve2BLxfO73kRNWeuN7PvTDN3E4eidBOd3hJ0CXx6ymwqweOfr2qDBsq7W4gz~RkXz9B98FEAWkhBNN06vL-TY2DHCR~cUbFVfPvPUpO3PgDEF~vCmSYce1qC8MPg__)

Caulfield R9 first response was incomplete (placeholder start time); a later response passed. Six race requests, 18 cache hits, no degraded races. All combinations, including trifecta and first four, were accepted.

---

### Friday 18 Sep 2026

- **Races:** Newcastle R8
- **Results:** 3 source bet components; 3 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $60.00 · Returned $0.00 · Net $-60.00. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/03e96e8d-7696-4f12-b404-c3bdae02a40d/recap.html?Expires=1823823904&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=ZcY36Xs-8UmD-8yOdK2Xl3q6yOEoOlZb8VhwxRuaERrlr4ztwEuarbsBSgtYnF0~ET71bYsmZF21rDz004UUIXSPykNhf3iKX~Aj3bMN-SxLQpK8IWqg74n1ujdQ~DKdIh5g1-oF22T9eu9m1Qdzt7FK3KdXF4MblI3tJbVD37CSCSpI4UdtzQVsZMyeOOxIwip9cPlKOe4YZzTEhtnmtMwQBqd-f30PlXqPH6U~MyPEcWKQvXjQ2a82-ho9lPRmmF8LGeQbxQTTBaTYMxx7DpmwVKYw4s4Qx3MNNE~BFl0Rs6WcPvm~t6KsbHD1IrYm1ZjagGvfi9Bhx1xKue~Kog__)

WIN, TRIFECTA and FIRST_4 all enriched from one race request and shared cache. No retries, exclusions or quarantine.

---

### Sunday 13 Sep 2026

- **Races:** Bathurst R1; Istanbul R2
- **Results:** 3 source bet components; 0 Kubrick-ready; 0 excluded; 3 quarantined.
- **Submitted financial totals:** Stake — · Returned — · Net —. No payload was submitted.
- **Outcome:** FULL FAILURE. No recap: all transactions were quarantined and Kubrick was not invoked.

Bathurst R1: two WIN bets quarantined for missing finishingPosition despite recovery of an estimated race time (TAB resulted time minus 10 minutes). Istanbul R2: one WIN quarantined for missing raceTime (NO_TAB_TIME_REFERENCE). Both races returned six consecutive incomplete responses; Kubrick was not called.

---

### Friday 11 Sep 2026

- **Races:** Goulburn R5
- **Results:** 3 source bet components; 3 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $50.00 · Returned $0.00 · Net $-50.00. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/1c2547fe-2afa-4c3b-9e6a-257dcbbca425/recap.html?Expires=1823823975&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=MbUCYXFARY8wDPyIxkzFGJ2JXPnoGkv1VyEJhwWiq231sREe-nWAy~ZpcZyViCwI-bL1rmSzgAQGlo8aXUPXpc-1hlv6imqHPzOHVVqfRa~pzXVtf0r~kSAGuBdJgZCnr40YKQKunKFhEWeCdtifyu3y84yp9tmA9x72bzU8iA9aFz4RdCiySfCGkhoQXRwy6tBMn3XIc0sL~Btt4f5Q6zUJKpxeaXZOUEITUuTZwG99Qt95bwyoGTJ0VNFy-C8AldTIsnwk7FUZLzlxB4KDpjh4pElzzkcFiDdwF5qlB2wxHc4GwLetjOEk0mpC9MitF51aQP~8EkDTuzkqySzSqg__)

Two WIN records and one PLACE record enriched from one race request. Four cache hits, no degraded responses.

---

### Monday 07 Sep 2026

- **Races:** Tatura R6; Dubbo R6/R7; Pinjarra R6; Warrnam R10
- **Results:** 8 source bet components; 6 Kubrick-ready; 1 excluded; 1 quarantined.
- **Submitted financial totals:** Stake $135.00 · Returned $600.00 · Net $465.00. 
- **Outcome:** PARTIAL FAILURE. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/77a46a8c-6f26-482f-848b-1ccb50fd3ffe/recap.html?Expires=1823824004&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=gAEkkkGpBNhNCwzJCHvpYixCy6Hnyp44R04y73eMHrVsclobXaVxjOEIeqeMA-Ie8Tmh84XvP~F7LUKlGs3ca~zr3QQ0jGjx9OCQR8wNiJZABOk5ghbS5qaA5bdhAi0Aj4Oo4EeFAJG6O7oKNWGzRnYxr2O~nr5qoeUQPt2TAtbyGj0425M37f5koCqUq990IjpXVQHq~WFNkL2zY2iWCHfwLQYbXqktZb5lWu9Ke2SOyGdVzjUJ6n02G13Du28WWG71DZJWstWoA3tFSRUakqsSUH8~9LOjsDDLQbA8se8YQ2U5ssm1Bgm4Qfonp6qZyYRLrivA~IoQATExnXYEgQ__)

Tatura combined WIN_AND_PLACE $500 base + $100 multiplier payout preserved. Dubbo R6 WIN/TRIFECTA/FIRST_4 and R7 WIN passed. Warrnam R10 was quarantined because its meeting identity could not be uniquely verified, leaving raceTime missing after eight probes. Pinjarra R6 was excluded before finalisation; racing-code classification should be independently checked.

---

### Thursday 27 Aug 2026

- **Races:** Wagga R8; Carlisle R1
- **Results:** 5 source bet components; 5 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $110.50 · Returned $0.00 · Net $-110.50. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/5281b190-1fbd-476c-b49e-6db210f10f96/recap.html?Expires=1823824027&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=d6lva434ftieGsOBbJQWiY65OGNsGv7WOVBX4gyiFprSoEHv2TvkVmzjNwDUl1VZofumiEZttM2~fndg8YK1tIVeEgUK4yTbBLQMBIRRRgmBWQwHkL3RE9v4mv~k1Sr~iz6tTcUAq10OTrV0E7p6lUItD9hH67vkugIkHmpZXwbhVDl82ZWRVLokF4gK8cNgApCt6bnFX9M3AjlPOFGrrRekfRd58ZANRQ29~uV7Eq2a4TwJMijr9gucz6P2HKcZmDuLfP8REcsG~hym6YWbH2ve-wuSwdROaYDQHRwJXbCUv68cmMFiLCgaW2opqd~hzWj6NYGW-jxczdB6X-8-Fw__)

Wagga WIN/PLACE/TRIFECTA/FIRST_4 and Carlisle WIN all enriched. Two race requests, seven cache hits, no incomplete response warnings.

---

### Wednesday 26 Aug 2026

- **Races:** Bathurst R3; Belmont R7
- **Results:** 3 source bet components; 2 Kubrick-ready; 1 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $148.00 · Returned $0.00 · Net $-148.00. 
- **Outcome:** PARTIAL FAILURE. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/b525537d-d765-487f-8487-c31d660f7afe/recap.html?Expires=1823824066&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=xl7OgIDQaubPKF~imuEzkeH34LnCnmHme6cjPtEtPbU2gkbFSUVdNeYkodnelcWvLwDMdxRP~u0uWmSFNxUoKTp1yo2CC5BtA0StejG5vy3kjhoYBQX6bX3CxkL~Q0f2ZKFE8U~9U03SEPJVFRjGwGgHaW0x9EGG9I7NudmjsEpJKzY-PGUJl3ctqAWY3Ju65DPhqhsT4jeikOxefAG~obVOWdRoZW5-C8Ca426aXZaT7k4BInK3s48IT0~jFGQjz~I03zXEB5U3u1sCtQ7Af9ZlNkfTndyivXP0PuQwWOJKAcKbMvVnTaYFo-OXNLZ4gLp80J321OmSwbhx9f4vXg__)

Belmont R7 WIN and PLACE passed. Bathurst R3 WIN was excluded before finalisation without a detailed reason in console output; check saved domain-classification evidence before assuming exclusion is correct.

---

### Saturday 22 Aug 2026

- **Races:** Randwick R3/R6/R10
- **Results:** 4 source bet components; 4 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $195.00 · Returned $0.00 · Net $-195.00. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/c7ed0d9c-ae88-4281-94a1-59f38e0f409b/recap.html?Expires=1823824103&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=R80m7nnU8i14bTFHVPDmVWck~MNsmGCHlKtQvX8iQ3NmlFM35r4GysKCujkS5lQQ8IiP00BZe~JdN0fwLSUbL83o-3urkL3WBxPk3iuVc~CrwXPcp52dvHtICzvy0aehRY9MwFsi1X1ftfzG-aytSVnSfl0kQxy9WyenQ25rJsrwzVAgqX89AxBa5438ykbxkBOuJhnDBOVTAcuuwuB3xwjjaEE5Wf-~W5puTargmEBZGLNvL9TtmkohEx9HHdTKsX5iDh2aTIoyniHjURgtOiHbIp9yIGlj8CrwpOCseCBvjuXfx8cCP3WMOTanKFK68ajef~K7ZklW0XtOqs8rsA__)

Four WIN bets across three races, including two separate bets on R6; no retries, exclusions or quarantine.

---

### Saturday 15 Aug 2026

- **Races:** Caulfield R2/R7; Broome R7
- **Results:** 4 source bet components; 2 Kubrick-ready; 0 excluded; 2 quarantined.
- **Submitted financial totals:** Stake $105.00 · Returned $0.00 · Net $-105.00. 
- **Outcome:** PARTIAL FAILURE. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/49e75a93-b915-457d-b0b0-aefa8521d9c5/recap.html?Expires=1823824141&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=fZxPRHJKhgzXGHLKPuLauyYMJR3LPyXDKhEGAQ~kW4DCz0hgaB20QRUQvN0cRnvlb03Mhb6Edq~l48JhURkLBroEhdSsVEytjuez7KzGGGRgUzts6Ak6L5Ti1y-e8N~CpRW5LYBIprc6JK6Hym-SYUUh-t3uoOM5NAGg8cQRS955zEe1FBpIJB-y-Y1MuKLe0F93EViuRq-SO0StIDSvf21pCHmYIvuOBpyTLvJBwsdZVQbg5Xpirz1~PO-b4GNeAp34o4nHvjlZYVjptMhr2Azaz2WSt75bf3lGfnYDeKH-i4yfEK4ENPNji0azMzhPoe2pZ9DC9pTvsxLfSnwPwA__)

Both Caulfield WIN bets passed. Two Broome R7 WIN bets were quarantined because raceTime was unavailable (NO_PLAUSIBLE_TIME_BET_TO_RESULT); all six historical API responses were incomplete and R6/R8 probes did not produce an acceptable time.

---

### Friday 14 Aug 2026

- **Races:** Gunnedah R3/R4/R7; Ipswich R3; Geelong R7
- **Results:** 8 source bet components; 4 Kubrick-ready; 1 excluded; 3 quarantined.
- **Submitted financial totals:** Stake $115.00 · Returned $360.00 · Net $245.00. 
- **Outcome:** PARTIAL FAILURE. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/b4fe018e-0b42-4fdf-99bd-d5af45426c28/recap.html?Expires=1823824195&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=zri-MjaoR9QHbcnHCIDFX6NzITMLFWWDAVZrN4JK5OEK9UDEU7Zc9jxNNUZhSB1VojwC5BPvFO1kYeqLnujE0G0cwigr~~Wa5DutV~XATSLbmqc4BnxKe0DQ2SCXs-P2PU4rBO2iHnmsyeDhgGeFWK8WFFQ7YxAa6n2K333oqH7jSOX0UUIorelx6cPyGOqMNryRvFUgxyJSQh4owaDPoNY-EjxRlM01uwVc4dGzmYFNGhYz7lvkgZjqlb8C~9f8RC107LtmIph0ORCKz8Em672ykU5FYbnlcClHpkQlxlnqYOyUEFwkkY-yI7jZx4sPcaxyPsGoat5bhkqHI3RJEg__)

Two Gunnedah transactions lacked finishingPosition and one lacked raceTime. R3 and R4 each exhausted six incomplete API attempts; some estimated times were recovered but not all required runner facts. Geelong R7 was excluded after horse/greyhound verification probes; classification needs confirmation. Four accepted bets reached Kubrick.

---

### Thursday 13 Aug 2026

- **Races:** Newcastle R5/R6/R7/R8; Bunbury R2/R4/R6; Moe R6; Rockhampton R5
- **Results:** 18 source bet components; 18 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $585.00 · Returned $1,434.00 · Net $849.00. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/f2225e5f-7775-49b0-b25a-1db1d44d3b1f/recap.html?Expires=1823824240&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=g~yB-lFiTZM1abzmMVXQBeZlleQtEnN~FEYwPeqK6c-O4WDjBPnRC8PXGp96b3LAFxq2wFbtGdJI-KAqKAZ2ur46oHEj9if1rPwTXpg9yHQbhzWFW2rQ7ggiQzm51lVVgOqJp7IBKXta4e9ptdSODRsVT8hjWOiXoJ~e6aiSr~JJDJXMt55-mcahMc4WIXcJDX0TeGpjGOg0fe5c9tr1u9wA4~ZoZHvZr7puBHL5DwyZPPtLC9gIGHmUCNuRJptRqn6tZlbG5U-G9UukgNU29w--ZxOt2Xr9EIsNSl4afiiqrBx6jle8JDO5SAhTLsDbxo2qThemLVnpu5-W9StR-Q__)

All 18 bets enriched across nine race requests, including fixed WIN/PLACE and TOTE_WIN_PLACE. Twenty-six cache hits and no degraded races. Payouts require independent transaction-level CSV reconciliation.

---

### Saturday 08 Aug 2026

- **Races:** Randwick R10
- **Results:** 4 source bet components; 4 Kubrick-ready; 0 excluded; 0 quarantined.
- **Submitted financial totals:** Stake $67.00 · Returned $0.00 · Net $-67.00. 
- **Outcome:** PASS. [Open generated recap](https://d2bs94wi893l8l.cloudfront.net/faaf839e-3a5f-4ac1-9e4b-67861f7bd739/recap.html?Expires=1823824262&Key-Pair-Id=K1A957H4UJ9LQ9&Signature=BerDK7aTmzyJeoyrhBhDQbPwTNqsKAPmlq76~Zj1ObtOLE6q~-cJnK4xKXbEtLFQ2-XztuA9gPGZ6fdG36LobV1rfkf~NPDSfSXTzHlrR3n-rgQX9ypNL2NXlUMMFwGhy9~JeQfMP32uyR3VEVgXXwDncDyKHb3Jiq2CuO7GihOBuoVXpK1T3H3GbypKhvIpkSnDm7B6uqSQqJXIA9kKj0yDFg7EOAuaMzgJJVhDpClv8EfDxIrdVXqR6Zu2FAx-gebxSA6zHqidZahtzez-xBZQvfgJMf2Q7eCnIVYd9~HuaLYk6uDKs0T6Oj9Nl9Wu5zg6F8XJViv25GlgzPF~mA__)

Three WIN bets and a FIRST_4 passed. First historical response had placeholder start time; a subsequent attempt succeeded. Two race requests, six cache hits, zero degraded races.


## Outstanding investigations

1. **Finishing positions (4 bets):** Bathurst R1 (2), Gunnedah R3/R4 (2). Check actual historical snapshots for safe alternatives; do not invent placing.
2. **Race times (4 bets):** Istanbul R2 (1), Broome R7 (2), Gunnedah R3/R4 (1). Check timestamp evidence and plausibility constraints.
3. **Unverified meeting (1 bet):** Warrnam R10; race identity not proven.
4. **Domain exclusions (3 bets):** Pinjarra R6, Bathurst R3, Geelong R7; verify horse/greyhound/harness classification using saved enrichment evidence.

These 12 cases account for all 9 quarantines plus 3 exclusions. Individual fields and bet amounts require source CSV and candidate `bettings.json` cross-checking; console summaries do not prove them independently.

## Regression baseline before cleanup

Do not remove existing output or meeting-lookup code solely because these runs reached READY. Preserve the current working normaliser version, capture representative API snapshots, and compare day-level canonical outputs before and after any safe refactoring. No production code was modified to prepare this report.
