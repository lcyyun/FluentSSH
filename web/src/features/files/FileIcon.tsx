import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  ArchiveRegular,
  CodeRegular,
  DocumentPdfRegular,
  DocumentRegular,
  DocumentTextRegular,
  FolderRegular,
  ImageRegular,
  LinkRegular,
  MusicNote2Regular,
  SlideTextRegular,
  VideoRegular
} from '@fluentui/react-icons';
import type { SftpEntry } from '@shared/types';
import { fileKind, type FileKind } from './file-utils';

const useStyles = makeStyles({
  base: { flexShrink: 0, display: 'block' },
  directory: { color: tokens.colorPaletteMarigoldForeground1 },
  symlink: { color: tokens.colorPaletteTealForeground2 },
  image: { color: tokens.colorPaletteGreenForeground1 },
  video: { color: tokens.colorPaletteBerryForeground2 },
  audio: { color: tokens.colorPalettePurpleForeground2 },
  archive: { color: tokens.colorPaletteDarkOrangeForeground1 },
  code: { color: tokens.colorPalettePurpleForeground2 },
  pdf: { color: tokens.colorPaletteRedForeground1 },
  document: { color: tokens.colorPaletteBlueForeground2 },
  text: { color: tokens.colorPaletteBlueForeground2 },
  other: { color: tokens.colorNeutralForeground3 }
});

const KIND_CLASS: Record<FileKind, keyof ReturnType<typeof useStyles>> = {
  directory: 'directory',
  symlink: 'symlink',
  image: 'image',
  video: 'video',
  audio: 'audio',
  archive: 'archive',
  code: 'code',
  pdf: 'pdf',
  document: 'document',
  text: 'text',
  other: 'other'
};

/** Type-coloured SFTP entry icon used by the table, grid and dialogs. */
export function FileIcon({
  entry,
  size = 16,
  className
}: {
  entry: Pick<SftpEntry, 'name' | 'type' | 'isSymlink'>;
  size?: number;
  className?: string;
}) {
  const styles = useStyles();
  const kind = fileKind(entry);
  const iconClass = mergeClasses(styles.base, styles[KIND_CLASS[kind]], className);
  const props = { className: iconClass, style: { fontSize: `${size}px` }, 'aria-hidden': true } as const;
  if (kind === 'directory') return <FolderRegular {...props} />;
  if (kind === 'symlink') return <LinkRegular {...props} />;
  if (kind === 'image') return <ImageRegular {...props} />;
  if (kind === 'video') return <VideoRegular {...props} />;
  if (kind === 'audio') return <MusicNote2Regular {...props} />;
  if (kind === 'archive') return <ArchiveRegular {...props} />;
  if (kind === 'code') return <CodeRegular {...props} />;
  if (kind === 'pdf') return <DocumentPdfRegular {...props} />;
  if (kind === 'document') return <SlideTextRegular {...props} />;
  if (kind === 'text') return <DocumentTextRegular {...props} />;
  return <DocumentRegular {...props} />;
}
