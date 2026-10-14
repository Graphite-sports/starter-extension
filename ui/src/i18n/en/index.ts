import type { BaseTranslation } from '../i18n-types';

// Base locale. After changing keys or parameters run `npm run i18n` to regenerate the types.
const en = {
  ClassesOfEvent: 'Classes of this event',
  OpenPage: 'Open starter page',
  PageTitle: 'Starter extension page',
  SayHello: 'Say hello',
  Hello: 'Hello from the starter extension',
  GameNote: 'The starter extension sees game "{name:string}"',
} satisfies BaseTranslation;

export default en;
