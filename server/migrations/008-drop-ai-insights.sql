-- The ai_insights table was reserved for an LLM integration that never
-- shipped; nothing ever wrote to it. Training insights are rules-based
-- (src/insights.js) and computed on the fly, so the table can go.
DROP TABLE IF EXISTS ai_insights;
