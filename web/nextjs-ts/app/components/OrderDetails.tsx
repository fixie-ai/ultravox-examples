'use client';

import React, { useState, useEffect } from 'react';
import { OrderDetailsData, OrderItem } from '@/lib/types';

function prepOrderDetails(orderDetailsData: OrderItem[]): OrderDetailsData {
  try {
    // console.log(`orderDetails: ${orderDetailsData}`);
    // const parsedItems: OrderItem[] = JSON.parse(orderDetailsData);
    // console.log(`parsedItems: ${JSON.stringify(parsedItems)}`);


    const totalAmount = orderDetailsData.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);
    // console.log(`parsedItems: ${JSON.stringify(parsedItems)}`);
    // console.log(totalAmount);

    // Construct the final order details object with total amount
    const orderDetails: OrderDetailsData = {
      items: orderDetailsData,
      totalAmount: Number(totalAmount.toFixed(2))
    };

    return orderDetails;
  } catch (error) {
    throw new Error(`Failed to parse order details: ${error}`, { cause: error });
  }
}

const OrderDetails: React.FC = () => {
  const [orderDetails, setOrderDetails] = useState<OrderDetailsData>({
    items: [],
    totalAmount: 0
  });

  useEffect(() => {
    const handleOrderUpdate = (event: CustomEvent<any>) => {
      console.log(`got event: ${JSON.stringify(event.detail)}`);

      let parsedItems: OrderItem[] = [];
      try {
        if (typeof event.detail === 'string') {
          parsedItems = JSON.parse(event.detail);
        } else if (Array.isArray(event.detail)) {

          parsedItems = event.detail;
        } else {
          console.error('Unexpected event.detail format:', event.detail);
          return;
        }

        // Validate that we have an array of items
        if (!Array.isArray(parsedItems)) {
          throw new Error('Event detail is not an array of items');
        }

        const formattedData: OrderDetailsData = prepOrderDetails(parsedItems);
        setOrderDetails(formattedData);
      } catch (error) {
        console.error('Failed to process order details:', error);
        console.error('Event detail type:', typeof event.detail);
        console.error('Event detail value:', event.detail);
        return;
      }
    };

    const handleCallEnded = () => {
      setOrderDetails({
        items: [],
        totalAmount: 0
      });
    };

    window.addEventListener('orderDetailsUpdated', handleOrderUpdate as EventListener);
    window.addEventListener('callEnded', handleCallEnded as EventListener);

    return () => {
      window.removeEventListener('orderDetailsUpdated', handleOrderUpdate as EventListener);
      window.removeEventListener('callEnded', handleCallEnded as EventListener);
    };
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatOrderItem = (item: OrderItem, index: number) => (
    <div key={index} className="mb-2 pl-4 border-l-2 border-gray-200">
      <div className="flex justify-between items-center">
        <span className="font-medium">{item.quantity}x {item.name}</span>
        <span className="text-gray-600">{formatCurrency(item.price * item.quantity)}</span>
      </div>
      {item.specialInstructions && (
        <div className="text-sm text-gray-500 italic mt-1">
          Note: {item.specialInstructions}
        </div>
      )}
    </div>
  );

  return (
    <div className="mt-10">
      <h1 className="text-xl font-bold mb-4">Order Details</h1>
      <div className="shadow-md rounded p-4">
        <div className="mb-4">
          <span className="text-gray-400 font-mono mb-2 block">Items:</span>
          {orderDetails.items.length > 0 ? (
            orderDetails.items.map((item, index) => formatOrderItem(item, index))
          ) : (
            <span className="text-gray-500 text-base font-mono">No items</span>
          )}
        </div>
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex justify-between items-center font-bold">
            <span className="text-gray-400 font-mono">Total:</span>
            <span>{formatCurrency(orderDetails.totalAmount)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderDetails;