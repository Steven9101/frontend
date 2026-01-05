import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { cn } from '../../lib/utils';

type AnimatedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
};

export function AnimatedDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  contentClassName,
}: AnimatedDialogProps) {
  const [present, setPresent] = React.useState(open);

  React.useEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  return (
    <DialogPrimitive.Root open={present} onOpenChange={handleOpenChange} modal={false}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      {present ? (
        <DialogPrimitive.Portal forceMount>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-md supports-[backdrop-filter]:bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(e) => {
              // Only close when the actual backdrop is clicked (not a bubbled event from another portal)
              if (e.target === e.currentTarget) onOpenChange(false);
            }}
          />

          <DialogPrimitive.Content forceMount asChild>
            <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
              <motion.div
                className={cn(
                  'w-[calc(100vw-2rem)] max-w-lg rounded-lg border bg-background p-6 pr-12 shadow-lg',
                  contentClassName,
                )}
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: open ? 1 : 0, scale: open ? 1 : 0.98, y: open ? 0 : 10 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                onAnimationComplete={() => {
                  if (!open) setPresent(false);
                }}
              >
                <div className="flex flex-col gap-1.5 text-center sm:text-left">
                  <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
                    {title}
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className="text-sm text-muted-foreground">
                      {description}
                    </DialogPrimitive.Description>
                  ) : null}
                </div>

                <div className="mt-5">{children}</div>

                {footer ? (
                  <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2">{footer}</div>
                ) : null}

                <button
                  type="button"
                  className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  aria-label="Close"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}
