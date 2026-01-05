import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { cn } from '../../lib/utils';

type AnimatedBottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
};

export function AnimatedBottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  contentClassName,
}: AnimatedBottomSheetProps) {
  const [present, setPresent] = React.useState(open);

  React.useEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  return (
    <DialogPrimitive.Root open={present} onOpenChange={onOpenChange} modal={true}>
      {present ? (
        <DialogPrimitive.Portal forceMount>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-md supports-[backdrop-filter]:bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.target === e.currentTarget) onOpenChange(false);
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />

          <DialogPrimitive.Content forceMount asChild>
            <div className="fixed inset-x-0 bottom-0 z-50">
              <motion.div
                className={cn(
                  'w-full rounded-t-xl border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-lg',
                  contentClassName,
                )}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: open ? 1 : 0, y: open ? 0 : 18 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                onAnimationComplete={() => {
                  if (!open) setPresent(false);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="text-base font-semibold leading-none tracking-tight">
                      {title}
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    aria-label="Close"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenChange(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4">{children}</div>

                {footer ? <div className="mt-4">{footer}</div> : null}
              </motion.div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}


