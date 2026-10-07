import { useEffect, useState } from 'react';
import { fetchRegistrationOpen } from '../services/settingsService.js';

// null while checking, then true or false. A failed check counts as closed,
// which is also what the security rules assume.
export const useRegistrationOpen = () => {
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let active = true;
    fetchRegistrationOpen()
      .then((value) => active && setOpen(value))
      .catch(() => active && setOpen(false));
    return () => {
      active = false;
    };
  }, []);

  return open;
};
