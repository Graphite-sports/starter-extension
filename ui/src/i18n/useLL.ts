import { useMemo } from 'react';
import { useEngineLocale } from '@graphite-sports/sdk';
import { i18nObject } from './i18n-util';
import { loadAllLocales } from './i18n-util.sync';

loadAllLocales();

/**
 * Translations of this extension in the locale the user selected in the engine.
 * The dictionaries must cover every locale of the engine, otherwise this fails to type-check.
 */
export function useLL() {
  const locale = useEngineLocale();
  return useMemo(() => i18nObject(locale), [locale]);
}
