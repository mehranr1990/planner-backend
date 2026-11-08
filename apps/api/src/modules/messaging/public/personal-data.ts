import { PersonalData } from '../../../platform/lifecycle/personal-data.js';
/** Only personal progress/settings; shared message bodies remain in their custody. */
export abstract class MessagingData extends PersonalData {}
