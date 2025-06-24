import React, { useState, useEffect } from 'react';

interface ToggleSwitchProps {
  isOn: boolean;
  handleToggle: () => void;
  onColor?: string;
  offColor?: string;
  id: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  isOn,
  handleToggle,
  onColor = 'bg-black',
  offColor = 'bg-black',
  id
}) => {
  const [isChecked, setIsChecked] = useState(isOn);

  useEffect(() => {
    setIsChecked(isOn);
  }, [isOn]);

  const toggleSwitch = () => {
    setIsChecked(!isChecked);
    handleToggle();
  };

  return (
    <div className="flex items-center">
      <input
        checked={isChecked}
        onChange={toggleSwitch}
        className="sr-only"
        type="checkbox"
        id={id}
      />
      <label
        htmlFor={id}
        className={`relative flex items-center w-10 h-6 rounded-full cursor-pointer transition-colors duration-600 ease-in-out border-2 border-white  ${
          isChecked ? onColor : offColor
        }`}
      >
        <span 
          className={`absolute w-3.5 h-3.5 rounded-full shadow-md transform transition-transform duration-600 ease-in-out ${
            isChecked ? 'bg-white translate-x-4' : 'bg-gray-700 translate-x-1'
          }`}
        />
      </label>
    </div>
  );
};

export default ToggleSwitch;