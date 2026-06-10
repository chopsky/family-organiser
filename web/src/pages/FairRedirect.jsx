import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isIos, APP_STORE_URL } from '../lib/app-store';

/**
 * School-fair smart link (the flyer QR points here). Routes by device so the
 * discount is claimed in the right place:
 *   • iPhone  → App Store (claim the discount in-app via the Apple Offer Code).
 *   • Android / desktop → web signup, tagged with the promo so it's saved to
 *     the account and auto-applied at the annual Stripe checkout.
 *
 * The campaign code comes ENTIRELY from `?promo=` - each flyer QR must include
 * it (e.g. /fair?promo=OAKWOOD25). No default, so a bare /fair never applies a
 * stale code from a different school.
 */
export default function FairRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const promo = params.get('promo');

  useEffect(() => {
    if (isIos()) {
      window.location.replace(APP_STORE_URL);
    } else {
      navigate(promo ? `/signup?promo=${encodeURIComponent(promo)}` : '/signup', { replace: true });
    }
  }, [navigate, promo]);

  return null;
}
