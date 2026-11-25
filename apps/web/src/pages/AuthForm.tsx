import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ru } from '@/i18n/ru';

const schema = z.object({
  email: z.string().email(ru.auth.invalidEmail),
  password: z.string().min(8, ru.auth.passwordTooShort),
});

export type AuthFormValues = z.infer<typeof schema>;

interface AuthFormProps {
  title: string;
  description: string;
  submitLabel: string;
  pending: boolean;
  errorMessage?: string;
  onSubmit: (values: AuthFormValues) => void;
  passwordAutoComplete: 'current-password' | 'new-password';
  footer: React.ReactNode;
}

// Общая форма входа и регистрации
export function AuthForm(props: AuthFormProps) {
  const form = useForm<AuthFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-14 sm:py-8"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 65% 45% at 50% 0%, color-mix(in oklab, var(--brand) 10%, transparent), transparent 68%), radial-gradient(ellipse 75% 55% at 50% 100%, color-mix(in oklab, var(--surface) 70%, transparent), transparent 72%), radial-gradient(var(--border) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 100% 100%, 18px 18px',
      }}
    >
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="outline" size="icon" />
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <BrandLogo size={32} showWordmark className="text-lg" />
        <Card className="w-full shadow-sm">
          <CardHeader>
            <CardTitle>{props.title}</CardTitle>
            <CardDescription>{props.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(props.onSubmit)} className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="auth-email">{ru.auth.email}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id="auth-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="auth-password">{ru.auth.password}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id="auth-password"
                          name="password"
                          type="password"
                          autoComplete={props.passwordAutoComplete}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {props.errorMessage ? (
                  <p role="alert" className="text-sm text-destructive">
                    {props.errorMessage}
                  </p>
                ) : null}
                <Button type="submit" disabled={props.pending}>
                  {props.submitLabel}
                </Button>
              </form>
            </Form>
            <p className="text-center text-sm text-muted-foreground">{props.footer}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
