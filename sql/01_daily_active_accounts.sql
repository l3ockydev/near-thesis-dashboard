-- 01: Daily active accounts on NEAR mainnet
-- Dataset: bigquery-public-data.crypto_near_mainnet_us
-- Cost note: always filter on block_date (partition) to keep the scan small.
-- This repo does not run BigQuery (zero-cost rule); provided for evidence reproduction.

SELECT
  block_date,
  COUNT(DISTINCT signer_id) AS daily_active_accounts,
  APPROX_COUNT_DISTINCT(transaction_hash) AS daily_transactions
FROM `bigquery-public-data.crypto_near_mainnet_us.transactions`
WHERE block_date >= DATE '2022-01-01'
GROUP BY block_date
ORDER BY block_date;
