import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Retokenised from upstream: `bg-popover`/`shadow-md` and the whole
 * `animate-in`/`slide-in-from-*` set are gone, in favour of the surface,
 * hairline and `slide-up-fade` the dialogs already use. Losing the exit
 * animation is the price of not adding `tailwindcss-animate` for one component.
 *
 * Radix portals this to document.body, which is *below* a native <dialog>
 * opened with showModal(). A popover rendered from inside one of those needs an
 * explicit `PopoverPrimitive.Portal container={dialogEl}`.
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 origin-[--radix-popover-content-transform-origin] animate-slide-up-fade rounded-lg border border-line bg-surface p-4 text-fg shadow-popover outline-none',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
