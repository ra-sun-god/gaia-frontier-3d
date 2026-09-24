'use client';

import React from 'react';
import { sound } from '@/lib/audio';
import { ChevronLeft, ChevronDown, X, Settings } from 'lucide-react';

interface ModalDockProps {
  onClose: () => void;
}

/**
 * Shared bottom squircle navigation dock used by every full-screen modal.
 * Previously this ~45-line block was copy-pasted six times.
 */
export const ModalDock: React.FC<ModalDockProps> = ({ onClose }) => {
  const handleClose = () => {
    sound.playUiClick();
    onClose();
  };

  return (
    <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-center gap-3">
      <button
        onClick={handleClose}
        className="w-12 h-12 btn-game-squircle cursor-pointer"
        title="Back"
      >
        <ChevronLeft className="w-6 h-6 stroke-[3]" />
      </button>

      <button
        onClick={handleClose}
        className="w-12 h-12 btn-game-squircle cursor-pointer"
        title="Minimize"
      >
        <ChevronDown className="w-6 h-6 stroke-[3]" />
      </button>

      <button
        onClick={handleClose}
        className="w-12 h-12 btn-game-squircle cursor-pointer"
        title="Close"
      >
        <X className="w-6 h-6 stroke-[3]" />
      </button>

      <button
        onClick={handleClose}
        className="w-12 h-12 btn-game-squircle cursor-pointer"
        title="Settings"
      >
        <Settings className="w-5 h-5 stroke-[2.5]" />
      </button>
    </div>
  );
};
