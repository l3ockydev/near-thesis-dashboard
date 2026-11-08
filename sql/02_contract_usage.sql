-- 02: Contract usage — top contracts by distinct senders per day
-- Dataset: bigquery-public-data.crypto_near_mainnet_us
-- Cost note: block_date partition filter keeps the bill small.

SELECT
  block_date,
  receiver_id,
  COUNT(DISTINCT signer_id) AS distinct_senders,
  COUNT(DISTINCT transaction_hash) AS transactions
FROM `bigquery-public-data.crypto_near_mainnet_us.transactions`
WHERE block_date >= DATE '2022-01-01'
  AND receiver_id NOT LIKE '%.near'  -- flip/comment this line for the full picture
GROUP BY block_date, receiver_id
HAVING transactions >= 100
ORDER BY block_date, transactions DESC;
