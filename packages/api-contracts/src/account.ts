import { z } from 'zod';

const LocaleSchema = z
  .string()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      new Intl.Locale(value);
      return true;
    } catch {
      return false;
    }
  });
const TimezoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const ImageSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  })
  .nullable();
export const ProfilePatchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    image: ImageSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const ProfileSchema = z.strictObject({
  id: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  name: z.string(),
  image: ImageSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const SettingsPatchSchema = z
  .strictObject({
    locale: LocaleSchema.optional(),
    timezone: TimezoneSchema.optional(),
    preferredCalendar: z.enum(['GREGORIAN', 'JALALI']).optional(),
    firstDayOfWeek: z.number().int().min(0).max(6).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const SettingsSchema = z.strictObject({
  locale: LocaleSchema,
  timezone: TimezoneSchema,
  preferredCalendar: z.enum(['GREGORIAN', 'JALALI']),
  firstDayOfWeek: z.number().int().min(0).max(6),
});
export const PersonalSpaceSchema = z.strictObject({
  id: z.string().uuid(),
  kind: z.literal('PERSONAL'),
  ownerUserId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const PersonalSpacesSchema = z.array(PersonalSpaceSchema).max(1);
type DefinedOptionals<T> = { [K in keyof T]?: Exclude<T[K], undefined> };
export type ProfilePatch = DefinedOptionals<z.infer<typeof ProfilePatchSchema>>;
export type SettingsPatch = DefinedOptionals<
  z.infer<typeof SettingsPatchSchema>
>;
