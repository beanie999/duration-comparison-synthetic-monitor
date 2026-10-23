/**
 * New Relic Synthetics - Scripted API monitor
 *
 * Compares the average Transaction duration for the last 5 minutes against the
 * same 5-minute window one week ago. If the difference exceeds the threshold
 * below, the monitor FAILS.
 *
 * Required secure credentials (Synthetics > Secure credentials):
 *   NEW_RELIC_API_KEY     - a User API key (NRAK-...) able to run NRQL queries
 *   NEW_RELIC_ACCOUNT_ID  - the numeric account ID to query
 *
 * Runtime: written for the modern Node-based scripted API runtime, which
 * provides `got` and `assert` globally/via require.
 */

// =============================================================================
// CONFIGURATION - edit these values to tune the monitor
// =============================================================================

// >>> FAILURE THRESHOLD (percent). Monitor fails if the change vs. last week
// >>> is GREATER than this value. e.g. 50 = fail on a >50% difference.
const THRESHOLD_PERCENT = 50;

// If true, a drop in duration larger than the threshold also fails the monitor
// (i.e. the absolute difference is compared). Set to false to only fail when
// duration has INCREASED by more than the threshold.
const FAIL_ON_DECREASE = true;

// The NRQL query to run. Must use COMPARE WITH so both values are returned.
const NRQL_QUERY =
  'FROM Transaction SELECT average(duration) since 5 minutes ago COMPARE WITH 1 week ago';

// NerdGraph endpoint. Use https://api.eu.newrelic.com/graphql for EU accounts.
const NERDGRAPH_URL = 'https://api.newrelic.com/graphql';

// =============================================================================
// SCRIPT
// =============================================================================

const got = require('got');
const assert = require('assert');

// Secure credentials are exposed to the script via the $secure object.
const API_KEY = $secure.NEW_RELIC_API_KEY;
const ACCOUNT_ID = $secure.NEW_RELIC_ACCOUNT_ID;

/**
 * Run the NRQL query through NerdGraph and return the raw results array.
 */
async function runNrql() {
  // Use GraphQL variables so the NRQL string never needs manual escaping.
  const graphql = `
    query ($accountId: Int!, $nrql: Nrql!) {
      actor {
        account(id: $accountId) {
          nrql(query: $nrql) {
            results
          }
        }
      }
    }`;

  console.log(`Running NRQL: ${NRQL_QUERY}`);

  const response = await got.post(NERDGRAPH_URL, {
    headers: {
      'Content-Type': 'application/json',
      'API-Key': API_KEY,
    },
    json: {
      query: graphql,
      variables: { accountId: parseInt(ACCOUNT_ID, 10), nrql: NRQL_QUERY },
    },
    responseType: 'json',
    timeout: { request: 30000 },
  });

  console.log(`NerdGraph HTTP status: ${response.statusCode}`);
  const body = response.body;

  // NerdGraph returns HTTP 200 even for query errors, so check explicitly.
  if (body.errors && body.errors.length > 0) {
    console.log('NerdGraph returned errors: ' + JSON.stringify(body.errors));
    throw new Error('NerdGraph error: ' + body.errors.map((e) => e.message).join('; '));
  }

  const results = body && body.data && body.data.actor.account.nrql.results;
  assert.ok(Array.isArray(results), 'NRQL response did not contain a results array');
  console.log('Raw NRQL results: ' + JSON.stringify(results));
  return results;
}

/**
 * Pull the current and previous values out of a COMPARE WITH result set.
 * Rows look like: { "average.duration": 0.42, "comparison": "current" | "previous" }
 */
function extractValues(results) {
  const current = results.find((r) => r.comparison === 'current');
  const previous = results.find((r) => r.comparison === 'previous');
  assert.ok(current && previous, 'Expected both "current" and "previous" rows from COMPARE WITH');

  // The value key is derived from the query (e.g. "average.duration"), so find
  // it dynamically rather than hard-coding it.
  const valueKey = Object.keys(current).find((k) => k !== 'comparison');
  assert.ok(valueKey, 'Could not find a value field in the NRQL result');

  return { valueKey, currentValue: current[valueKey], previousValue: previous[valueKey] };
}

async function main() {
  // Fail fast with a clear message if credentials are missing.
  assert.ok(API_KEY, 'Secure credential NEW_RELIC_API_KEY is not set');
  assert.ok(ACCOUNT_ID, 'Secure credential NEW_RELIC_ACCOUNT_ID is not set');
  assert.ok(!isNaN(parseInt(ACCOUNT_ID, 10)), 'NEW_RELIC_ACCOUNT_ID must be numeric');

  console.log(`Threshold: ${THRESHOLD_PERCENT}% (fail on decrease: ${FAIL_ON_DECREASE})`);

  const results = await runNrql();
  const { valueKey, currentValue, previousValue } = extractValues(results);
  console.log(`Metric: ${valueKey}`);
  console.log(`Current (last 5 min):      ${currentValue}`);
  console.log(`Previous (same, 1 wk ago): ${previousValue}`);

  // No data in either window means we cannot make a valid comparison.
  assert.ok(
    typeof currentValue === 'number' && typeof previousValue === 'number',
    `Missing data - current=${currentValue}, previous=${previousValue}`
  );

  // Avoid divide-by-zero when last week's value was 0.
  if (previousValue === 0) {
    assert.ok(
      currentValue === 0,
      `Previous value was 0 but current is ${currentValue}; percentage change is undefined`
    );
    console.log('Both values are 0 - no change. PASS');
    return;
  }

  // Percentage change relative to last week's value.
  const changePercent = ((currentValue - previousValue) / previousValue) * 100;
  console.log(`Change vs. 1 week ago: ${changePercent.toFixed(2)}%`);

  const compared = FAIL_ON_DECREASE ? Math.abs(changePercent) : changePercent;
  if (compared > THRESHOLD_PERCENT) {
    // Throwing marks the synthetic check as failed.
    throw new Error(
      `FAIL: ${valueKey} changed by ${changePercent.toFixed(2)}% vs. 1 week ago ` +
        `(threshold ${THRESHOLD_PERCENT}%)`
    );
  }

  console.log(`PASS: change of ${changePercent.toFixed(2)}% is within the ${THRESHOLD_PERCENT}% threshold`);
}

main();
