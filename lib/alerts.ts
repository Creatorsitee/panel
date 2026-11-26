'use client';

import Swal from 'sweetalert2';

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark');
}

function getBaseColors() {
  const dark = isDarkTheme();
  return {
    background: dark ? '#141920' : '#ffffff',
    color: dark ? '#f4f4f5' : '#09090b',
    toastBackground: dark ? '#1b222c' : '#ffffff',
  };
}

function isModalOpen(): boolean {
  if (!Swal.isVisible()) return false;
  const popup = Swal.getPopup();
  return Boolean(popup && !popup.classList.contains('cmnty-swal-toast'));
}

export async function showSuccessToast(title: string, text?: string): Promise<void> {
  if (isModalOpen()) return;
  const colors = getBaseColors();
  await Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title,
    text,
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
    background: colors.toastBackground,
    color: colors.color,
    customClass: {
      popup: 'cmnty-swal-toast',
      title: 'cmnty-swal-title',
      htmlContainer: 'cmnty-swal-html',
    },
  });
}

export async function showInfoToast(title: string, text?: string): Promise<void> {
  if (isModalOpen()) return;
  const colors = getBaseColors();
  await Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'info',
    title,
    text,
    showConfirmButton: false,
    timer: 2400,
    timerProgressBar: true,
    background: colors.toastBackground,
    color: colors.color,
    customClass: {
      popup: 'cmnty-swal-toast',
      title: 'cmnty-swal-title',
      htmlContainer: 'cmnty-swal-html',
    },
  });
}

export async function showErrorToast(title: string, text?: string): Promise<void> {
  if (isModalOpen()) return;
  const colors = getBaseColors();
  await Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'error',
    title,
    text,
    showConfirmButton: false,
    showCloseButton: false,
    timer: 3200,
    timerProgressBar: true,
    background: colors.toastBackground,
    color: colors.color,
    customClass: {
      popup: 'cmnty-swal-toast',
      title: 'cmnty-swal-title',
      htmlContainer: 'cmnty-swal-html',
    },
  });
}

export async function showErrorAlert(title: string, text?: string): Promise<void> {
  const colors = getBaseColors();
  await Swal.fire({
    icon: 'error',
    title,
    text,
    confirmButtonText: 'Tutup',
    confirmButtonColor: '#dc2626',
    heightAuto: false,
    background: colors.background,
    color: colors.color,
    customClass: {
      popup: 'cmnty-swal-popup',
      title: 'cmnty-swal-title',
      htmlContainer: 'cmnty-swal-html',
    },
  });
}

export async function showWarningAlert(title: string, text?: string): Promise<void> {
  const colors = getBaseColors();
  await Swal.fire({
    icon: 'warning',
    title,
    text,
    confirmButtonText: 'Mengerti',
    confirmButtonColor: '#d97706',
    heightAuto: false,
    background: colors.background,
    color: colors.color,
    customClass: {
      popup: 'cmnty-swal-popup',
      title: 'cmnty-swal-title',
      htmlContainer: 'cmnty-swal-html',
    },
  });
}

export async function showConfirmDialog(options: {
  title: string;
  text: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const colors = getBaseColors();
  const result = await Swal.fire({
    icon: options.destructive ? 'warning' : 'question',
    title: options.title,
    text: options.text,
    showCancelButton: true,
    confirmButtonText: options.confirmText || 'Konfirmasi',
    cancelButtonText: options.cancelText || 'Batal',
    confirmButtonColor: options.destructive ? '#dc2626' : '#0891b2',
    cancelButtonColor: isDarkTheme() ? '#344050' : '#71717a',
    reverseButtons: true,
    heightAuto: false,
    background: colors.background,
    color: colors.color,
    customClass: {
      popup: 'cmnty-swal-popup',
      title: 'cmnty-swal-title',
      htmlContainer: 'cmnty-swal-html',
    },
  });
  return result.isConfirmed;
}
