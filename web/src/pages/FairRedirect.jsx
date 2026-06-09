import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isIos, APP_STORE_URL } from '../lib/app-store';

/**
 * School-fair smart link (the flyer QR points here). Routes by device so the
 * discount is claimed in the right place:
 *   • iPhone  → App Store (claim 25% in-app via the Apple Offer Code).
 *   • Android / desktop → web signup, tagged with the promo so it's saved to
 *     the account and auto-applied at the annual Stripe checkout.
 *
 * Defaults to the HILLELFEST campaign; `?promo=` overrides for reuse.
 */
export default function FairRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const promo = params.get('promo') || 'HILLELFEST';

  useEffect(() => {
    if (isIos()) {
      window.location.replace(APP_STORE_URL);
    } else {
      navigate(`/signup?promo=${encodeURIComponent(promo)}`, { replace: true });
    }
  }, [navigate, promo]);

  return null;
}
