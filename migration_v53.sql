-- V53: Visit ke saath User-Agent (browser / device / bot pehchan).
-- Referrer pehle se post_visits + product_visits mein save ho raha hai (V3 / V46).
-- "Requests per IP" naya column nahi, ip (V50) se query mein nikalta hai.
-- Safe: dobara chalane se kuch nahi bigarta.

ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS user_agent VARCHAR(300);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS user_agent VARCHAR(300);
