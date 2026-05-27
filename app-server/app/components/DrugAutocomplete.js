'use client';

import { useState, useEffect, useRef } from 'react';
import Fuse from 'fuse.js';
import DRUGS from '@/app/lib/drugDatabase';

export default function DrugAutocomplete({ value, onChange, placeholder = 'Search drug...' }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef(null);
  const fuseRef = useRef(null);

  // Initialise Fuse once
  useEffect(() => {
    fuseRef.current = new Fuse(DRUGS, {
      threshold: 0.35,
      distance: 100,
      minMatchCharLength: 2,
    });
  }, []);

  // Sync external value changes (e.g. row cleared)
  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    setHighlighted(0);

    if (val.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // Fuse local search first
    const local = fuseRef.current
      ? fuseRef.current.search(val).slice(0, 8).map(r => r.item)
      : [];

    if (local.length > 0) {
      setSuggestions(local);
      setOpen(true);
    } else {
      // Fallback: PostgreSQL search via API
      setSuggestions([]);
      setOpen(false);
      fetch(`/api/drugs?q=${encodeURIComponent(val)}`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data.drugs) && data.drugs.length > 0) {
            setSuggestions(data.drugs);
            setOpen(true);
          }
        })
        .catch(() => {});
    }
  }

  function handleSelect(drug) {
    setQuery(drug);
    onChange(drug);
    setSuggestions([]);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions[highlighted]) handleSelect(suggestions[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => query.length >= 2 && suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((drug, i) => (
            <li
              key={drug}
              onMouseDown={() => handleSelect(drug)}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                i === highlighted
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-800 hover:bg-slate-50'
              }`}
            >
              {drug}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
