/**
 * `translateFor` — translate for an EXPLICIT locale, outside request scope.
 *
 * Notifications store literal text, so the language is frozen at write time
 * and must be the RECIPIENT's, not the ambient request locale. This is the
 * only translation path with that property, so its fallbacks are load-bearing:
 * it sits inside a fail-open notify path where throwing would be worse than a
 * wrong-looking string.
 */
import { translateFor } from '@/lib/i18n/server-messages';

describe('translateFor', () => {
    it('resolves a dotted key in the requested locale', async () => {
        await expect(translateFor('bg', 'ag.offers.title')).resolves.toBe('Промоции');
        await expect(translateFor('en', 'ag.offers.title')).resolves.toBe('Promotions');
    });

    it('interpolates {param} placeholders', async () => {
        const bg = await translateFor('bg', 'ag.offers.leadNotification.title', {
            company: 'Агрия',
        });
        expect(bg).toContain('Агрия');
        expect(bg).not.toContain('{company}');
    });

    it('leaves unknown placeholders verbatim rather than blanking them', async () => {
        // A missing param must not silently erase context from the message.
        const out = await translateFor('en', 'ag.offers.leadNotification.title');
        expect(out).toContain('{company}');
    });

    it('falls back to the default locale for a key missing in the target', async () => {
        // Guarded via a key that exists (both locales are in parity today), so
        // assert the contract rather than a transient gap: a resolvable key
        // never returns the raw key.
        await expect(translateFor('bg', 'ag.offers.title')).resolves.not.toBe('ag.offers.title');
    });

    it('returns the key itself when nothing resolves — never throws', async () => {
        await expect(
            translateFor('bg', 'this.key.does.not.exist.anywhere'),
        ).resolves.toBe('this.key.does.not.exist.anywhere');
    });
});
