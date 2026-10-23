# Duration Comparison Synthetic Monitor

A New Relic Synthetics **scripted API** monitor that compares the average `Transaction` duration over the last 5 minutes with the same window one week ago. The monitor fails if the difference exceeds a configurable percentage.

It runs this NRQL query through NerdGraph:

```
FROM Transaction SELECT average(duration) since 5 minutes ago COMPARE WITH 1 week ago
```

## Setup

1. In New Relic, go to **Synthetic monitoring > Secure credentials** and add:

   | Key                    | Value                                             |
   | ---------------------- | ------------------------------------------------- |
   | `NEW_RELIC_API_KEY`    | A User API key (`NRAK-...`) that can run NRQL     |
   | `NEW_RELIC_ACCOUNT_ID` | The numeric ID of the account you want to query   |

2. Create a new **Scripted API** monitor using a current Node-based runtime (the script uses `got`, so the legacy `$http` runtime will not work).
3. Paste in the contents of [duration-comparison-monitor.js](duration-comparison-monitor.js), choose a run frequency and location, and save.

## Configuration

All settings are in the configuration block at the top of the script:

| Constant            | Default | Description                                                                                       |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `THRESHOLD_PERCENT` | `50`    | The monitor fails if the change versus last week is greater than this percentage.                 |
| `FAIL_ON_DECREASE`  | `true`  | If `true`, a drop larger than the threshold also fails. Set to `false` to fail only on increases. |
| `NRQL_QUERY`        |         | The query to run. It must use `COMPARE WITH` so both values are returned.                         |
| `NERDGRAPH_URL`     | US URL  | Use `https://api.eu.newrelic.com/graphql` for EU accounts.                                        |

## Behaviour

The monitor **passes** when the percentage change is within the threshold. It **fails** when:

- The change exceeds the threshold.
- A secure credential is missing, or the account ID is not numeric.
- NerdGraph returns an error.
- Either time window has no data.
- Last week's value was `0` but the current value is not (the change is undefined).

The script logs the query, HTTP status, raw results, current and previous values, and the calculated change to the monitor's script log. It never logs the API key or account ID.
