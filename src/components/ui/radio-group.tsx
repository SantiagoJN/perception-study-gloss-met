import { createContext, useContext, useId, type HTMLAttributes, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type RadioContextValue = {
  name: string;
  value: string;
  onValueChange?: (value: string) => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

type RadioGroupProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

function RadioGroup({ className, value = '', onValueChange, children, ...props }: RadioGroupProps) {
  const name = useId();
  return (
    <RadioContext.Provider value={{ name, value, onValueChange }}>
      <div role="radiogroup" data-slot="radio-group" className={cn('grid gap-2 w-full', className)} {...props}>
        {children}
      </div>
    </RadioContext.Provider>
  );
}

type RadioGroupItemProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'name'>;

function RadioGroupItem({ className, value = '', disabled, style, ...props }: RadioGroupItemProps) {
  const context = useContext(RadioContext);
  if (!context) throw new Error('RadioGroupItem must be rendered inside RadioGroup.');
  const checked = context.value === String(value);
  return (
    <input
      type="radio"
      role="radio"
      name={context.name}
      value={value}
      checked={checked}
      disabled={disabled}
      onChange={() => context.onValueChange?.(String(value))}
      data-slot="radio-group-item"
      data-checked={checked || undefined}
      className={cn(
        'appearance-none border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-destructive focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:aria-invalid:border-destructive/50 flex size-4 rounded-full focus-visible:ring-3 aria-invalid:ring-3 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input group-has-[:focus-visible]/field-label:data-checked:border-primary group/radio-group-item peer relative aspect-square shrink-0 border outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={checked ? { ...style, boxShadow: 'inset 0 0 0 3px var(--primary)' } : style}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem };
