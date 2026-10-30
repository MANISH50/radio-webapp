import type { RequestHandler } from 'express';
import { forbidden } from '../lib/errors.js';

// Common scripting/HTTP-library and crawler user agents. Real browsers never send these.
const AUTOMATION_UA =
  /(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp|libwww-perl|scrapy|httpclient|node-fetch|undici|axios|postman|insomnia|phantomjs|spider|crawler|\bbot\b)/i;

/**
 * Cheap heuristics against scripted scraping. They are a speed bump, not a wall: a
 * determined client can spoof every header. Rate limits, page-size and offset caps, and
 * the session token do the real work.
 */
export function botGuard(): RequestHandler {
  return (req, _res, next) => {
    const ua = req.get('user-agent') ?? '';
    if (ua.length < 10 || ua.length > 512 || AUTOMATION_UA.test(ua)) {
      return next(forbidden('CLIENT_REJECTED', 'Request not allowed'));
    }
    const accept = req.get('accept');
    if (req.method === 'GET' && accept && !/(application\/json|\*\/\*)/.test(accept)) {
      return next(forbidden('CLIENT_REJECTED', 'Request not allowed'));
    }
    next();
  };
}
