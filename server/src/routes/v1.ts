import { Router } from 'express';
import type { Config } from '../config.js';
import { ok } from '../lib/envelope.js';
import { byIp, bySession, rateLimit, type RateStore } from '../security/rateLimit.js';
import {
  CountryParams,
  SearchQuery,
  StationParams,
  StationQuery,
  validate,
  validated,
} from '../security/validate.js';
import type { Catalog } from '../services/catalog.js';

interface Deps {
  cfg: Config;
  catalog: Catalog;
  rateStore: RateStore;
}

/** Read-only catalogue endpoints plus click reporting. Mounted behind session + CSRF checks. */
export function v1Router({ cfg, catalog, rateStore }: Deps): Router {
  const r = Router();
  const readLimit = rateLimit({ store: rateStore, name: 'read', limit: cfg.limits.readPerToken, key: bySession });
  const clickLimits = [
    rateLimit({ store: rateStore, name: 'click-ip', limit: cfg.limits.clickPerIp, key: byIp(cfg.sessionSecret) }),
    rateLimit({ store: rateStore, name: 'click', limit: cfg.limits.clickPerToken, key: bySession }),
  ];

  r.get('/countries', readLimit, async (_req, res) => {
    const countries = await catalog.countries();
    res.set('Cache-Control', 'private, max-age=300');
    res.json(ok(countries, { total: countries.length }));
  });

  r.get(
    '/countries/:code/stations',
    readLimit,
    validate({ params: CountryParams, query: StationQuery }),
    async (_req, res) => {
      const { code } = validated<{ code: string }>(res, 'params');
      const q = validated<StationQuery>(res, 'query');
      const result = await catalog.countryStations(code, q);
      res.set('Cache-Control', 'private, max-age=60');
      res.json(
        ok(result.items, {
          page: q.page,
          limit: q.limit,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / q.limit)),
          facets: result.facets,
        }),
      );
    },
  );

  r.get('/stations/search', readLimit, validate({ query: SearchQuery }), async (_req, res) => {
    const q = validated<SearchQuery>(res, 'query');
    const result = await catalog.search(q.q, q.page, q.limit);
    res.set('Cache-Control', 'private, max-age=60');
    res.json(ok(result.items, { page: q.page, limit: q.limit, hasMore: result.hasMore }));
  });

  r.post('/stations/:uuid/click', ...clickLimits, validate({ params: StationParams }), async (_req, res) => {
    const { uuid } = validated<{ uuid: string }>(res, 'params');
    const counted = await catalog.click(uuid);
    res.json(ok({ counted }));
  });

  return r;
}
