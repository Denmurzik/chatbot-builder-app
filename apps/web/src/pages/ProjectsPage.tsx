import { zodResolver } from '@hookform/resolvers/zod';
import { LogOut, MoreVertical, Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { useLogout, useMe } from '@/api/auth';
import {
  type ProjectSummary,
  useCreateProject,
  useDeleteProject,
  useProjects,
  useRenameProject,
} from '@/api/projects';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const nameSchema = z.object({ name: z.string().trim().min(1, ru.projects.nameRequired) });

function CreateProjectDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = form.handleSubmit(({ name }) => {
    createProject.mutate(name, {
      onSuccess: (project) => {
        props.onOpenChange(false);
        form.reset();
        navigate(`/projects/${project.id}`);
      },
      onError: () => toast.error(ru.common.unknownError),
    });
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ru.projects.createTitle}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="create-project-name">{ru.projects.nameLabel}</FormLabel>
                  <FormControl>
                    <Input {...field} id="create-project-name" name="name" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
                {ru.common.cancel}
              </Button>
              <Button type="submit" disabled={createProject.isPending}>
                {ru.common.create}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Диалог переименования проекта
function RenameProjectDialog(props: { project: ProjectSummary; onClose: () => void }) {
  const renameProject = useRenameProject();
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: props.project.name },
  });

  const onSubmit = form.handleSubmit(({ name }) => {
    renameProject.mutate(
      { id: props.project.id, name },
      {
        onSuccess: () => {
          toast.success(ru.projects.renamed);
          props.onClose();
        },
        onError: () => toast.error(ru.projects.renameError),
      },
    );
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ru.projects.renameTitle}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="rename-project-name">{ru.projects.nameLabel}</FormLabel>
                  <FormControl>
                    <Input {...field} id="rename-project-name" name="name" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onClose}>
                {ru.common.cancel}
              </Button>
              <Button type="submit" disabled={renameProject.isPending}>
                {ru.projects.renameSave}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Диалог подтверждения удаления проекта с предупреждением о подключённых ботах
function DeleteProjectDialog(props: { project: ProjectSummary; onClose: () => void }) {
  const deleteProject = useDeleteProject();
  const botsCount = props.project.botsCount ?? 0;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ru.projects.deleteTitle}</DialogTitle>
          <DialogDescription>{ru.projects.deleteDescription(props.project.name)}</DialogDescription>
        </DialogHeader>
        {botsCount > 0 ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {ru.projects.deleteBotsWarning(botsCount)}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {ru.common.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteProject.isPending}
            onClick={() =>
              deleteProject.mutate(props.project.id, {
                onSuccess: () => {
                  toast.success(ru.projects.deleted);
                  props.onClose();
                },
                onError: () => toast.error(ru.projects.deleteError),
              })
            }
          >
            {ru.projects.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { data: author } = useMe();
  const { data: projects, isLoading, isError } = useProjects();
  const logout = useLogout();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [renamingProject, setRenamingProject] = useState<ProjectSummary | null>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-5 px-4 py-4 sm:gap-6 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3">
        <BrandLogo size={24} showWordmark className="text-base" />
        <div className="flex min-w-0 items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="max-w-[160px] sm:max-w-none">
                <span className="truncate">{author?.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
              >
                <LogOut />
                {ru.auth.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{ru.projects.title}</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus />
          {ru.projects.create}
        </Button>
      </div>

      {isLoading ? <p className="text-muted-foreground">{ru.common.loading}</p> : null}
      {isError ? <p className="text-destructive">{ru.projects.loadError}</p> : null}
      {projects && projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-muted-foreground sm:p-12">
          <Workflow className="size-8" />
          <p>{ru.projects.empty}</p>
        </div>
      ) : null}
      {projects && projects.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => {
            const isPublished = (project.publishedBotsCount ?? 0) > 0;
            return (
              <li key={project.id}>
                <Card className="relative transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-[var(--brand)]/50 hover:shadow-sm">
                  <Link
                    to={`/projects/${project.id}`}
                    className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <CardHeader className="pr-14 pb-3">
                      <CardTitle className="truncate">{project.name}</CardTitle>
                      <CardDescription>
                        {ru.projects.updatedAt}:{' '}
                        {new Date(project.updatedAt).toLocaleString('ru-RU')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-2 pt-0">
                      {isPublished ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <span className="relative flex size-2" aria-hidden="true">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                          </span>
                          {ru.projects.publishedBadge}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <span
                            className="inline-flex size-2 rounded-full bg-muted-foreground/50"
                            aria-hidden="true"
                          />
                          {ru.projects.draftBadge}
                        </span>
                      )}
                      {typeof project.blocksCount === 'number' ? (
                        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
                          {ru.projects.blocksCount(project.blocksCount)}
                        </span>
                      ) : null}
                      {project.messengers?.map((messenger) =>
                        messenger === 'TELEGRAM' ? (
                          <span
                            key={messenger}
                            className="inline-flex items-center rounded-md border border-[#229ED9]/30 bg-[#229ED9]/12 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#167BAE] dark:text-[#4BB8EC]"
                          >
                            TG
                          </span>
                        ) : (
                          <span
                            key={messenger}
                            className="inline-flex items-center rounded-md border border-[#0077FF]/30 bg-[#0077FF]/12 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#005FCC] dark:text-[#5CA3FF]"
                          >
                            VK
                          </span>
                        ),
                      )}
                    </CardContent>
                  </Link>
                  <div className="absolute top-3 right-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={ru.projects.actionsLabel(project.name)}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenamingProject(project)}>
                          <Pencil className="size-4" />
                          {ru.projects.rename}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeletingProject(project)}
                        >
                          <Trash2 className="size-4" />
                          {ru.projects.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}

      <CreateProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      {renamingProject ? (
        <RenameProjectDialog project={renamingProject} onClose={() => setRenamingProject(null)} />
      ) : null}
      {deletingProject ? (
        <DeleteProjectDialog project={deletingProject} onClose={() => setDeletingProject(null)} />
      ) : null}
    </div>
  );
}
