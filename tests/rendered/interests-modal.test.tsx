/** @jest-environment jsdom */
/**
 * Interests editor modal — chip add/remove + PUT-replace save. The Modal shell
 * (Radix) is stubbed to a simple pass-through so the test focuses on the chip
 * editor + the /me/interests PUT wiring; fetch + useTenantApiUrl are mocked.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl: () => (p: string) => `/api/t/acme${p}`,
}));

jest.mock('@/components/ui/modal', () => {
    const Modal = ({ showModal, children }: { showModal: boolean; children: React.ReactNode }) =>
        showModal ? <div data-testid="modal">{children}</div> : null;
    Modal.Header = ({ title }: { title: string }) => <h2>{title}</h2>;
    Modal.Body = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
    Modal.Actions = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
    return { Modal };
});

import { InterestsModal } from '@/components/trends/InterestsModal';

const okFetch = (keywords: string[]) =>
    jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ keywords }) });

beforeEach(() => {
    global.fetch = okFetch([]);
});

describe('InterestsModal', () => {
    it('renders the initial keywords as chips', () => {
        render(<InterestsModal open initial={['wheat', 'subsidy']} onClose={jest.fn()} onSaved={jest.fn()} />);
        expect(screen.getByText('wheat')).toBeInTheDocument();
        expect(screen.getByText('subsidy')).toBeInTheDocument();
    });

    it('adds a keyword on Enter (normalized) and removes one via its ×', () => {
        render(<InterestsModal open initial={['wheat']} onClose={jest.fn()} onSaved={jest.fn()} />);
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '  Maize ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByText('maize')).toBeInTheDocument();

        // Two chips now (wheat, maize) → two remove buttons (same i18n-key name
        // under the mock). Remove the first (wheat); maize remains.
        const removes = screen.getAllByRole('button', { name: 'news.forYou.removeChip' });
        expect(removes).toHaveLength(2);
        fireEvent.click(removes[0]);
        expect(screen.getByText('maize')).toBeInTheDocument();
        expect(screen.queryByText('wheat')).not.toBeInTheDocument();
    });

    it('PUT-replaces on Save and reports the stored set', async () => {
        const onSaved = jest.fn();
        const onClose = jest.fn();
        global.fetch = okFetch(['wheat', 'maize']);
        render(<InterestsModal open initial={['wheat']} onClose={onClose} onSaved={onSaved} />);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'maize' } });
        fireEvent.click(screen.getByRole('button', { name: 'news.forYou.add' }));

        fireEvent.click(screen.getByRole('button', { name: 'news.forYou.save' }));

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('/api/t/acme/me/interests');
        expect(opts.method).toBe('PUT');
        expect(JSON.parse(opts.body)).toEqual({ keywords: ['wheat', 'maize'] });
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(['wheat', 'maize']));
        expect(onClose).toHaveBeenCalled();
    });

    it('Cancel closes without a network call', () => {
        const onClose = jest.fn();
        render(<InterestsModal open initial={['wheat']} onClose={onClose} onSaved={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'news.forYou.cancel' }));
        expect(onClose).toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
