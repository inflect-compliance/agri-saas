/**
 * Unit — ExchangeMap popup helper.
 *
 * The map popup rebuilds a listing from the clustered source's flattened
 * GeoJSON properties. It previously hard-coded `regionCode: ''`, which broke
 * the detail Sheet's region + filters when a listing was opened from a marker.
 * `featureToMapListing` must carry the real regionCode through.
 */
import { featureToMapListing } from '@/components/exchange/exchange-map-utils';

const props = {
    id: 'lst-1',
    side: 'SELL',
    commodity: 'Wheat',
    quantityTonnes: '250',
    pricePerTonne: '320',
    priceCurrency: 'BGN',
    regionCode: 'BG-16',
    regionName: 'Plovdiv',
    lat: 42.1,
    lon: 24.7,
};

it('carries regionCode (and every field) through from the feature properties', () => {
    const l = featureToMapListing(props);
    expect(l.regionCode).toBe('BG-16');
    expect(l).toMatchObject({
        id: 'lst-1', side: 'SELL', commodity: 'Wheat', quantityTonnes: '250',
        pricePerTonne: '320', priceCurrency: 'BGN', regionName: 'Plovdiv', lat: 42.1, lon: 24.7,
    });
});

it('normalises an empty price to null and a missing regionCode to ""', () => {
    const l = featureToMapListing({ ...props, pricePerTonne: '', regionCode: undefined });
    expect(l.pricePerTonne).toBeNull();
    expect(l.regionCode).toBe('');
});
