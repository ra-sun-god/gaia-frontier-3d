import type {MetadataRoute} from 'next';
import {SITE_URL} from '@/lib/site';

/**
 * robots.txt — served at /robots.txt.
 *
 * Search crawlers are welcome on the landing page; the /api/* game-save
 * endpoints are player data routes and stay crawler-free.
 *
 * AI discovery: every major LLM crawler is EXPLICITLY allowed (they inherit
 * the `*` rule anyway, but an explicit allow block removes ambiguity for
 * agents that check for their own UA before fetching). /llms.txt is the
 * curated entry point for AI assistants.
 */
const AI_CRAWLERS = [
  'GPTBot', // OpenAI — model training
  'OAI-SearchBot', // OpenAI — search
  'ChatGPT-User', // OpenAI — user-initiated fetches
  'ClaudeBot', // Anthropic — training
  'Claude-Web', // Anthropic — live fetches
  'anthropic-ai',
  'PerplexityBot', // Perplexity — search indexing
  'Perplexity-User',
  'Google-Extended', // Google — Gemini grounding
  'Applebot-Extended', // Apple — Apple Intelligence
  'cohere-ai',
  'CCBot', // Common Crawl — feeds many open models
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
      {
        userAgent: AI_CRAWLERS,
        allow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
