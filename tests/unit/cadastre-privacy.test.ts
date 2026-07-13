/**
 * Unit — cadastre import PRIVACY strip. Owner-ish attribute keys must never
 * reach persisted parcel properties; land-use / geometry keys must survive.
 */
import { isOwnerAttributeKey, stripOwnerAttributes } from '@/lib/cadastre/privacy';

describe('isOwnerAttributeKey', () => {
    const owner = [
        'СОБСТВЕНИК', 'собственик_име', 'SOBSTVENIK', 'owner', 'OWNER_NAME',
        'ЕГН', 'EGN', 'адрес', 'ADRES', 'BULSTAT', 'титуляр', 'ИМЕ', 'име',
        'имена', 'лице', 'holder', 'proprietor',
    ];
    const keep = [
        'CADNUM', 'EKATTE', 'MASIV', 'IMOT', 'NTP', 'PLOSHT', 'AREA_DKA',
        'НАИМЕНОВАНИЕ', 'наименование', 'начин_на_ползване', 'geometry', 'kod',
    ];
    it.each(owner)('flags owner-ish key %s', (k) => {
        expect(isOwnerAttributeKey(k)).toBe(true);
    });
    it.each(keep)('keeps non-owner key %s', (k) => {
        expect(isOwnerAttributeKey(k)).toBe(false);
    });
});

describe('stripOwnerAttributes', () => {
    it('drops owner-ish keys, preserves the rest', () => {
        const out = stripOwnerAttributes({
            CADNUM: '68134.8360.729',
            NTP: 'нива',
            PLOSHT: 12.5,
            СОБСТВЕНИК: 'Иван Петров',
            EGN: '1234567890',
            ADRES: 'ул. Хан Аспарух 1',
        });
        expect(out).toEqual({ CADNUM: '68134.8360.729', NTP: 'нива', PLOSHT: 12.5 });
        expect(out).not.toHaveProperty('СОБСТВЕНИК');
        expect(out).not.toHaveProperty('EGN');
        expect(out).not.toHaveProperty('ADRES');
    });
    it('returns an empty object for non-object input', () => {
        expect(stripOwnerAttributes(null)).toEqual({});
        expect(stripOwnerAttributes(undefined)).toEqual({});
    });
    it('preserves a land-use НАИМЕНОВАНИЕ designation (не owner)', () => {
        expect(stripOwnerAttributes({ НАИМЕНОВАНИЕ: 'земеделска земя' })).toEqual({
            НАИМЕНОВАНИЕ: 'земеделска земя',
        });
    });
});
